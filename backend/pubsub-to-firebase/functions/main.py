import base64, json, os, re, hashlib, datetime
import firebase_admin
from firebase_admin import db

_ILLEGAL = re.compile(r"[.#$/\[\]]")


def _safe_key(s: str) -> str:
    return _ILLEGAL.sub("_", str(s))


_APP_READY = False


def _ensure_firebase():
    global _APP_READY
    if _APP_READY and firebase_admin._apps:
        return True
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL is not set")
        return False
    if not firebase_admin._apps:
        firebase_admin.initialize_app(options={"databaseURL": db_url})
    _APP_READY = True
    print("Firebase Admin initialized with", db_url)
    return True


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _server_ts():
    return {".sv": "timestamp"}


def _ctx_summary(ctx):
    return {
        "event_id": getattr(ctx, "event_id", None),
        "timestamp": getattr(ctx, "timestamp", None),
        "event_type": getattr(ctx, "event_type", None),
        "resource": getattr(ctx, "resource", None),
    }


def _get_msg(envelope):
    # { "message": {...} } と {...} の両方に対応
    if (
        isinstance(envelope, dict)
        and "message" in envelope
        and isinstance(envelope["message"], dict)
    ):
        return envelope["message"]
    return envelope if isinstance(envelope, dict) else {}


# ==== T1000 HEX → 構造体デコーダ（0x08に対応） ====
def _fmt_mac(bs: bytes) -> str:
    return ":".join(f"{b:02x}" for b in bs)


def _event_flags_byte(event_status: int) -> dict:
    # 下位8bitだけを見る（0x00FF）
    eb = event_status & 0xFF
    return {
        "start_moving": bool(eb & 0x01),
        "end_movement": bool(eb & 0x02),
        "motionless": bool(eb & 0x04),
        "shock": bool(eb & 0x08),
        "temp_event": bool(eb & 0x10),
        "light_event": bool(eb & 0x20),
        "sos": bool(eb & 0x40),
        "press_once": bool(eb & 0x80),
    }


def _to_iso_jst(epoch_sec: int) -> str:
    try:
        # UTC+9 (日本標準時)
        jst = datetime.timezone(datetime.timedelta(hours=9))
        return datetime.datetime.fromtimestamp(epoch_sec, tz=jst).isoformat()
    except Exception:
        return _now_iso()


def decode_t1000_hex(hexstr: str) -> dict:
    """
    SenseCAP T1000 payload decoder (minimum).
    Frame ID 0x08（Bluetooth Location & Sensor）を重点対応。
    """
    try:
        b = bytes.fromhex(hexstr.strip())
    except Exception as e:
        return {"error": f"invalid_hex: {e}", "hex": hexstr}

    if not b:
        return {"error": "empty", "hex": hexstr}

    fid = b[0]
    out = {"frame_id": fid, "length": len(b), "hex": hexstr.lower()}
    print(f"[INFO] T1000 {hexstr} frame_id=0x{fid:02x} length={len(b)}")

    if fid == 0x08 and len(b) >= 35:
        event_status = (b[1] << 16) | (b[2] << 8) | b[3]
        flags = _event_flags_byte(event_status)
        motion_seg = b[4]
        utc = int.from_bytes(b[5:9], "big", signed=False)

        mac1 = _fmt_mac(b[9:15])
        rssi1 = int.from_bytes(b[15:16], "big", signed=True)
        mac2 = _fmt_mac(b[16:22])
        rssi2 = int.from_bytes(b[22:23], "big", signed=True)
        mac3 = _fmt_mac(b[23:29])
        rssi3 = int.from_bytes(b[29:30], "big", signed=True)

        temp_raw = int.from_bytes(b[30:32], "big", signed=True)
        light_raw = int.from_bytes(b[32:34], "big", signed=False)
        battery = b[34]

        out.update(
            {
                "event_status": event_status,
                "motion_segment": motion_seg,
                "utc": utc,
                "utc_iso": _to_iso_jst(utc),
                "beacons": [
                    {"mac": mac1, "rssi": rssi1},
                    {"mac": mac2, "rssi": rssi2},
                    {"mac": mac3, "rssi": rssi3},
                ],
                "temperature_c": temp_raw / 10.0,
                "light_pct": light_raw,
                "battery_pct": battery,
                # イベントフラグと motion_detect の判定
                "events": flags,
                "motion_detect": bool(flags["start_moving"] or flags["shock"]),
            }
        )
        return out

    return out


# —— 外側JSON・内側ペイロードまで保存する最小実装 ——
def pubsub_to_rtdb(data, context):
    if not _ensure_firebase():
        return "init_error"

    msg = _get_msg(data)
    attrs = msg.get("attributes", {}) or {}
    data_b64 = msg.get("data", "") or ""
    message_id = (
        msg.get("messageId")
        or msg.get("message_id")
        or getattr(context, "event_id", None)
    )
    publish_time = (
        msg.get("publishTime")
        or msg.get("publish_time")
        or getattr(context, "timestamp", None)
    )

    # ① 外側 Base64 → uplink JSON
    uplink = {}
    raw_text = None
    if data_b64:
        try:
            raw_text = base64.b64decode(data_b64).decode("utf-8")
            uplink = json.loads(raw_text)
        except Exception as e:
            print("WARN: outer data decode/json failed:", e)
            uplink = {}
    else:
        print("INFO: no message.data in Pub/Sub")

    # devEUI 決定（attributes の dev_eui も見る）
    dev_eui = (
        (uplink.get("deviceInfo") or {}).get("devEui")
        or attrs.get("devEui")
        or attrs.get("dev_eui")
        or "unknown"
    )
    dev_key = _safe_key(dev_eui)

    # 重複排除キー
    dedup = (
        uplink.get("deduplicationId")
        or attrs.get("deduplicationId")
        or message_id
        or hashlib.sha256(
            (json.dumps(uplink, sort_keys=True) + str(publish_time)).encode()
        ).hexdigest()[:16]
    )
    dedup_key = _safe_key(dedup)

    # まず原本を保存（そのまま）
    # raw_doc = {
    #     "raw": data,  # Pub/Sub から受けたそのまま（attributes, data(base64) 等）
    #     "context": _ctx_summary(context),
    #     "receivedAt": _now_iso(),
    #     "serverTs": _server_ts(),
    # }
    # db.reference(f"raw/pubsub/{dedup_key}").transaction(lambda cur: cur or raw_doc)
    # print(f"RAW saved at /raw/pubsub/{dedup}")

    # uplink JSON を保存（あれば）
    # if uplink:
    #     db.reference(f"devices/{dev_key}/events/{dedup_key}").set(
    #         {
    #             "uplink": uplink,  # 外側JSONをそのまま格納
    #             "attributes": attrs,
    #             "meta": {
    #                 "messageId": message_id,
    #                 "publishTime": publish_time,
    #                 "savedAt": _now_iso(),
    #                 "serverTs": _server_ts(),
    #                 "source": "pubsub/chirpstack",
    #             },
    #         }
    #     )

    # ② uplink.data（アプリペイロード）の Base64 → 生バイト
    inner_b64 = uplink.get("data") if isinstance(uplink, dict) else None
    if inner_b64:
        try:
            raw_b = base64.b64decode(inner_b64)
            hexstr = raw_b.hex()
            # db.reference(f"devices/{dev_key}/t1000_raw/{dedup_key}").set(
            #     {
            #         "base64": inner_b64,
            #         "hex": hexstr,
            #         "length": len(raw_b),
            #         "eventTime": uplink.get("time") or publish_time,
            #         "savedAt": _now_iso(),
            #         "serverTs": _server_ts(),
            #     }
            # )

            # 再デコードして詳細を保存 & beacons に反映
            decoded = decode_t1000_hex(hexstr)
            # db.reference(f"devices/{dev_key}/t1000_decoded/{dedup_key}").set(
            #     {
            #         **decoded,
            #         "meta": {
            #             "messageId": message_id,
            #             "publishTime": publish_time,
            #             "savedAt": _now_iso(),
            #             "serverTs": _server_ts(),
            #         },
            #     }
            # )

            # frame_id 0x08 の場合は beacons を snapshot＋履歴に書き込む
            if decoded.get("frame_id") == 0x08 and decoded.get("beacons"):
                ts_iso = decoded.get("utc_iso") or _now_iso()
                enriched = [{**b, "ts": ts_iso} for b in decoded["beacons"]]
                db.reference(f"devices/{dev_key}").update(
                    {
                        "beacons": enriched,
                        "beaconsUpdatedAt": ts_iso,
                        "beaconsUpdatedAtServer": _server_ts(),
                    }
                )
                db.reference(f"devices/{dev_key}/beacon_logs/{dedup_key}").set(
                    {
                        "beacons": enriched,
                        "battery_pct": decoded.get("battery_pct"),
                        "temperature_c": decoded.get("temperature_c"),
                        "light_pct": decoded.get("light_pct"),
                        "motion_detect": decoded.get("motion_detect"),
                        "events": decoded.get("events"),
                        "savedAt": ts_iso,
                        "savedAtServer": _server_ts(),
                    }
                )
                # --- ここから：デバイスの現在ステータスを更新（shock / motion など） ---
                events = decoded.get("events") or {}
                motion_detect = bool(decoded.get("motion_detect"))
                is_shock = bool(events.get("shock"))
                # 代表イベント名を1つ決めたい場合は優先順位で選ぶ
                event_name = (
                    "shock" if is_shock else
                    ("start_moving" if events.get("start_moving") else
                     ("end_movement" if events.get("end_movement") else
                      ("motionless" if events.get("motionless") else
                       ("press_once" if events.get("press_once") else
                        ("sos" if events.get("sos") else
                         ("temp_event" if events.get("temp_event") else
                          ("light_event" if events.get("light_event") else None)))))))
                )

                status_payload = {
                    "motion": motion_detect,
                    "shock": is_shock,
                    "lastEvent": event_name,
                    "lastEventRaw": decoded.get("event_status"),
                    "lastEventFrameId": "0x08",
                    "lastEventDedup": dedup_key,
                    "lastEventAt": ts_iso,
                    "lastEventAtServer": _server_ts(),
                }
                db.reference(f"devices/{dev_key}/status").update(status_payload)

                # オプション：ショック回数カウンタ
                # if is_shock:
                #     db.reference(f"devices/{dev_key}/status/shock_count").transaction(
                #         lambda cur: (cur or 0) + 1
                #     )
                # --- ここまで：デバイスの現在ステータスを更新 ---
                print(f"decoded T1000 beacons{dev_key}: {decoded}")
                print("Saved beacons from T1000 0x08")
        except Exception as e:
            print("WARN: inner payload base64 decode failed:", e)

    print(
        f"Saved devEUI={dev_eui} key={dedup} (uplink {'ok' if uplink else 'none'}, inner {'ok' if inner_b64 else 'none'})"
    )
    return "ok"
