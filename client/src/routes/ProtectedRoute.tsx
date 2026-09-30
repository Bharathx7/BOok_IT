import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { homePathFor } from "./homePath";

interface ProtectedRouteProps {
  allowedRoles?: string[];
}

function ProtectedRoute({
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  // Wait for the saved session to be restored before deciding anything.
  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-slate-500">
        Loading...
      </div>
    );
  }

  // User is not logged in: come back here after signing in.
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // User is logged in but doesn't have permission
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
