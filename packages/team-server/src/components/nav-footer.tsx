import { LATEST_VERSION as LATEST_CHANGELOG_VERSION } from "../lib/changelog";
import { ChangelogNavLink } from "./changelog-nav-link";

export function NavFooter({ email }: { email: string }) {
  return (
    <div className="shell-nav-footer">
      <span className="mono email">{email}</span>
      <div className="row">
        <ChangelogNavLink latestVersion={LATEST_CHANGELOG_VERSION} />
        <span className="sep">·</span>
        <a href="/logout">Sign out</a>
      </div>
    </div>
  );
}
