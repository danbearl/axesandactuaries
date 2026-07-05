import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useClerk } from '@clerk/react';
import './Navigation.css';

interface Props {
  player: { username: string; gold: number; reputation: number };
}

export default function Navigation({ player }: Props) {
  const { signOut } = useClerk();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the user menu on any click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <nav className="nav-sidebar">
      <div className="nav-guild-seal">
        <img src="/images/logo.png" alt="Axes & Actuaries" className="seal-logo" />
        <div className="seal-text">
          <span className="seal-title">Axes &</span>
          <span className="seal-title">Actuaries</span>
        </div>
      </div>

      <div className="nav-player-card">
        <div className="nav-user-menu" ref={menuRef}>
          <button
            className="nav-user-menu-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="nav-player-name">{player.username}</span>
            <span className="nav-user-menu-chevron">{menuOpen ? '▴' : '▾'}</span>
          </button>
          {menuOpen && (
            <div className="nav-user-menu-dropdown" role="menu">
              <button
                className="nav-user-menu-item"
                role="menuitem"
                onClick={() => { setMenuOpen(false); navigate('/profile'); }}
              >
                Profile
              </button>
              {/* Add more menu items here as the app grows (e.g. settings). */}
              <button
                className="nav-user-menu-item"
                role="menuitem"
                onClick={() => signOut()}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
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
      </div>
    </nav>
  );
}
