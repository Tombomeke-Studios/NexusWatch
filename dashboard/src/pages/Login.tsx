/** The login screen, shown instead of the app while the collector asks for a password. */
import { useId, useState, type FormEvent } from 'react';
import { useLogin } from '@/api/queries';
import { ApiError } from '@/api/client';
import { Logo } from '@/components/layout/Logo';

export function LoginPage() {
  const id = useId();
  const [password, setPassword] = useState('');
  const login = useLogin();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) login.mutate(password);
  };
  const error = login.error instanceof ApiError ? (login.error.status === 0 ? 'The collector does not answer' : login.error.message) : login.isError ? 'Could not log in' : null;

  return (
    <main className="login">
      <form className="box login-card" onSubmit={submit} aria-labelledby={`${id}-t`}>
        <Logo />
        <h1 id={`${id}-t`} style={{ fontSize: 20, margin: '18px 0 4px' }}>Log in</h1>
        <p className="muted" style={{ margin: '0 0 18px', fontSize: 13.5 }}>This dashboard is protected by the password set on the collector.</p>
        <div className="fld">
          <label htmlFor={`${id}-pw`}>Password</label>
          <input
            id={`${id}-pw`}
            className="inp"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <div id={`${id}-err`} className="form-err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        <button type="submit" className="btn pri" style={{ width: '100%', marginTop: 16, justifyContent: 'center' }} disabled={!password || login.isPending}>
          {login.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </main>
  );
}
