import { LoginForm } from "../../components/LoginForm";

interface LoginPageProps {
  onLoginSuccess: (user: { name: string; role: string; token: string }) => void;
  onProceedAsGuest: () => void | Promise<void>;
}

export function LoginPage({ onLoginSuccess, onProceedAsGuest }: LoginPageProps) {
  return (
    <LoginForm
      onLoginSuccess={onLoginSuccess}
      onProceedAsGuest={onProceedAsGuest}
    />
  );
}
