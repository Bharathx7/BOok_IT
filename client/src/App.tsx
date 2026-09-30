import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastProvider";
import { NotificationProvider } from "./context/NotificationProvider";
import { I18nProvider } from "./i18n/I18nProvider";

function App() {
  return (
    <I18nProvider>
    <AuthProvider>
      <BrowserRouter>
        <ToastProvider>
          <NotificationProvider>
            <AppRoutes />
          </NotificationProvider>
        </ToastProvider>
      </BrowserRouter>
    </AuthProvider>
    </I18nProvider>
  );
}

export default App;
