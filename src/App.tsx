import {app} from "./firebase";

function App() {
  return (
    <main>
      <h1>Firebase Hosting + React + Vite</h1>
      <p>
        Firebase initialized! App name: <code>{app.name}</code>
      </p>
      <p>Edit <code>src/App.tsx</code> and save to see live updates.</p>
    </main>
  );
}

export default App;
