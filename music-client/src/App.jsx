import { useAuth } from './context/AuthContext.jsx';
import Login  from './components/Login.jsx';
import Layout from './components/Layout.jsx';

export default function App() {
  const { isAuth } = useAuth();
  return isAuth ? <Layout /> : <Login />;
}
