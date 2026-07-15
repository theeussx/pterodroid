import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../stores/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, checking } = useAuth();
  const location = useLocation();

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="w-2 h-2 rounded-full bg-signal animate-pulse-dot" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}
