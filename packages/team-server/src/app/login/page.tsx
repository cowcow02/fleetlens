import { LoginForm } from "../../components/login-form";
import { FleetlensBrand } from "../../components/fleetlens-brand";
import { instanceState } from "../../lib/server-config";

export default async function LoginPage() {
  const state = await instanceState();
  return (
    <>
      <header className="masthead">
        <FleetlensBrand />
        <div className="masthead-meta">
          <span className="mono">SIGN IN</span>
        </div>
      </header>
      <LoginForm allowSignup={state.allowPublicSignup} />
    </>
  );
}
