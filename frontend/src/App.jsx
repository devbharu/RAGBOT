
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import Chatbot from "./components/Chatbot";
import ReportPanel from "./components/ReportPanel";


export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Chatbot />} />
          <Route path="/report" element={<ReportPanel />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}