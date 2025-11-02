import base64, json, os, re, hashlib, datetime
import firebase_admin
from firebase_admin import db

_ILLEGAL = re.compile(r"[.#$/\[\]]")
_MAX_LOG_CHARS = int(os.getenv("LOG_DECODED_MAXLEN", "4000"))


def _safe_key(s: str) -> str:
    return _ILLEGAL.sub("_", str(s))


def _log_json(label: str, obj: dict, maxlen: int = _MAX_LOG_CHARS):
    """共通ログ関数: 辞書をJSON化して出力（長さ制限付き）"""
    try:
        s = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception as e:
        s = f"<json-dumps-error: {e}>"
    if len(s) > maxlen:
        s = s[:maxlen] + f"...(truncated {len(s)-maxlen} chars)"
    print(f"{label}: {s}")


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
    0x06: GNSS + sensor + battery
    0x08: BLE + sensor + battery
    """
    try:
        b = bytes.fromhex(hexstr.strip())
    except Exception as e:
        return {"error": f"invalid_hex: {e}", "hex": hexstr, "length": 0}

    if not b:
        return {"error": "empty", "hex": hexstr, "length": 0}

    fid = b[0]
    out = {"frame_id": fid, "length": len(b), "hex": hexstr.lower()}

    # ---- 0x06 GNSS Location & Sensor ----
    # Spec (Seeed Wiki):
    # Byte1:  ID(0x06)
    # 2-4:    event status (uint24)
    # 5:      motion segment (uint8)
    # 6-9:    UTC time (uint32, big-endian)
    # 10-13:  longitude (int32, 1e-6 deg)
    # 14-17:  latitude  (int32, 1e-6 deg)
    # 18-19:  temperature (int16, /10 ℃)
    # 20-21:  light (uint16, 0-100)
    # 22:     battery (uint8, %)
    if fid == 0x06 and len(b) >= 22:
        event_status = (b[1] << 16) | (b[2] << 8) | b[3]
        motion_seg = b[4]
        utc = int.from_bytes(b[5:9], "big", signed=False)
        lon_raw = int.from_bytes(b[9:13], "big", signed=True)
        lat_raw = int.from_bytes(b[13:17], "big", signed=True)
        temp_raw = int.from_bytes(b[17:19], "big", signed=True)
        light_raw = int.from_bytes(b[19:21], "big", signed=False)
        battery = b[21]

        lon = lon_raw / 1_000_000.0
        lat = lat_raw / 1_000_000.0

        out.update(
            {
                "event_status": event_status,
                "motion_segment": motion_seg,
                "utc": utc,
                "utc_iso": _to_iso_jst(utc),
                "lon": lon,
                "lat": lat,
                "temperature_c": temp_raw / 10.0,
                "light_pct": light_raw,
                "battery_pct": battery,
            }
        )
        return out

    # ---- 0x08 Bluetooth Location & Sensor (あなたの既存実装) ----
    if fid == 0x08 and len(b) >= 35:
        event_status = (b[1] << 16) | (b[2] << 8) | b[3]
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
            }
        )
        return out

    # 未対応/短いフレームはそのまま返す
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
    if data_b64:
        try:
            raw_text = base64.b64decode(data_b64).decode("utf-8")
            uplink = json.loads(raw_text)
        except Exception as e:
            print(f"WARN: outer data decode/json failed: {e}")
    else:
        print("INFO: no message.data in Pub/Sub")

    # 外側uplinkのログ（base64本文は隠して長さだけ）
    uplink_log = dict(uplink) if isinstance(uplink, dict) else {}
    if "data" in uplink_log and isinstance(uplink_log["data"], str):
        uplink_log["data_len"] = len(uplink_log["data"])
        uplink_log["data"] = "<omitted: base64>"
    _log_json(
        "Uplink",
        {
            "attributes": attrs,
            "messageId": message_id,
            "publishTime": publish_time,
            "uplink": uplink_log,
        },
    )

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

    # ② uplink.data（アプリペイロード）の Base64 → 生バイト
    inner_b64 = uplink.get("data") if isinstance(uplink, dict) else None
    if inner_b64:
        try:
            raw_b = base64.b64decode(inner_b64)
            hexstr = raw_b.hex()

            # 再デコードして詳細を保存 & beacons に反映
            decoded = decode_t1000_hex(hexstr)

            # ★ ここで「どんなフレームでも」ログ
            _log_json(
                f"{dev_eui}.decoded",
                {
                    "device": dev_eui,
                    "dedup": dedup,
                    "decoded": decoded,
                },
            )
            print(
                f"INFO: decoded uplink data for {dev_eui} dedup={dedup} frame_id=0x{decoded.get('frame_id', 0):02x}"
            )

            # ---- 0x06 GNSS: スナップショット + 履歴に保存 ----
            if (
                decoded.get("frame_id") == 0x06
                and ("lon" in decoded)
                and ("lat" in decoded)
            ):
                ts_iso = decoded.get("utc_iso") or _now_iso()
                gnss_doc = {
                    "lon": decoded["lon"],
                    "lat": decoded["lat"],
                    "utc": decoded.get("utc"),
                    "utc_iso": ts_iso,
                    "event_status": decoded.get("event_status"),
                    "motion_segment": decoded.get("motion_segment"),
                    "battery_pct": decoded.get("battery_pct"),
                    "temperature_c": decoded.get("temperature_c"),
                    "light_pct": decoded.get("light_pct"),
                    "savedAtServer": _server_ts(),
                }

                # スナップショット
                db.reference(f"devices/{dev_key}/gnss").update(gnss_doc)

                # 履歴（dedup キー）
                db.reference(f"devices/{dev_key}/gnss_logs/{dedup_key}").set(gnss_doc)

            # ---- 0x08 BLE: 既存の保存処理（そのまま）----
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
                        "savedAt": ts_iso,
                        "savedAtServer": _server_ts(),
                    }
                )
                # print("Saved beacons from T1000 0x08")
        except Exception as e:
            print(f"WARN: inner payload base64 decode failed: {e}")
    else:
        print(f"INFO: uplink of {dev_eui} has no 'data' field")

    # print(
    #     f"Saved devEUI={dev_eui} key={dedup} (uplink {'ok' if uplink else 'none'}, inner {'ok' if inner_b64 else 'none'})"
    # )
    return "ok"
