import { Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ChatPage from './pages/ChatPage';
import SettingsPage from './pages/SettingsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default App;
