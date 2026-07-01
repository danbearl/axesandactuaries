import { NavLink } from 'react-router-dom';
import { useClerk } from '@clerk/clerk-react';
import './Navigation.css';

interface Props {
  player: { username: string; gold: number; reputation: number };
}

export default function Navigation({ player }: Props) {
  const { signOut } = useClerk();
  return (
    <nav className="nav-sidebar">
      <div className="nav-guild-seal">
        <div className="seal-emblem">⚔</div>
        <div className="seal-text">
          <span className="seal-title">Adventurer</span>
          <span className="seal-title">Manager</span>
        </div>
      </div>

      <div className="nav-player-card">
        <div className="nav-player-name">{player.username}</div>
        <div className="nav-stats">
          <div className="nav-stat">
            <span className="label">Gold</span>
            <span className="currency">{player.gold.toLocaleString()} gp</span>
          </div>
          <div className="nav-stat">
            <span className="label">Reputation</span>
            <span className="value">{player.reputation}</span>
          </div>
        </div>
      </div>

      <div className="divider-ornate">NAVIGATION</div>

      <ul className="nav-links">
        <li>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">⚔</span>
            Dashboard
          </NavLink>
        </li>
        <li>
          <NavLink to="/market/adventurers" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">⚑</span>
            Hire Adventurers
          </NavLink>
        </li>
        <li>
          <NavLink to="/market/contracts" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">📜</span>
            Contracts
          </NavLink>
        </li>
        <li>
          <NavLink to="/properties" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">🏛</span>
            Properties
          </NavLink>
        </li>
        <li>
          <NavLink to="/transactions" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            <span className="nav-icon">📒</span>
            Ledger
          </NavLink>
        </li>
      </ul>

      <div className="nav-footer">
        <span className="label">Guild Charter · Season I</span>
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: '0.5rem', width: '100%' }}
          onClick={() => signOut()}
        >
          Sign Out
        </button>
      </div>
    </nav>
  );
}
