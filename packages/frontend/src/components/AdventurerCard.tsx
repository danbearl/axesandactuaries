import type { Adventurer } from '@adventurer-manager/types';
import { VOCATION_TIERS } from '@adventurer-manager/types';
import './AdventurerCard.css';

interface Props {
  adventurer: Adventurer;
  compact?: boolean;
  onHire?: () => void;
  onFire?: () => void;
  repRequired?: number;
}

const STAT_MAX = 20;

const PERSONALITY_LABELS = {
  loyalty:     ['Mercenary', 'Unreliable', 'Neutral', 'Loyal', 'Steadfast'],
  ambition:    ['Content', 'Passive', 'Neutral', 'Driven', 'Obsessed'],
  temperament: ['Cautious', 'Careful', 'Balanced', 'Bold', 'Reckless'],
  disposition: ['Gruff', 'Reserved', 'Neutral', 'Friendly', 'Amiable'],
};

export default function AdventurerCard({ adventurer: a, compact, onHire, onFire, repRequired }: Props) {
  const tierIndex = a.level < 5 ? 0 : a.level < 10 ? 1 : 2;
  const title = VOCATION_TIERS[a.vocation][tierIndex];
  const xpToNext = (a.level * 100) - (a.experience % (a.level * 100));

  if (compact) {
    return (
      <div className={`adv-card-compact ${a.status === 'injured' ? 'adv-injured' : ''}`}>
        <div className="adv-compact-left">
          <div className="adv-name">{a.name}</div>
          <div className="flex gap-xs items-center mt-sm">
            <span className={`badge badge-status-${a.status}`}>{STATUS_LABELS[a.status]}</span>
            <span className="badge badge-heritage">{a.heritage}</span>
            <span className="badge badge-vocation">{title}</span>
          </div>
        </div>
        <div className="adv-compact-right" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="text-right">
            <div className="label">Lv.{a.level} · {a.dailyWage} gp/day</div>
            <div className="label">Power {a.powerRating}</div>
          </div>
          {onFire && a.status !== 'on_adventure' && (
            <button className="btn btn-danger btn-sm" onClick={onFire} title="Release from roster">
              Release
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`adv-card panel ${a.status === 'injured' ? 'adv-injured' : ''}`}>
      <div className="adv-header">
        <div>
          <h3 className="adv-name-lg">{a.name}</h3>
          <div className="flex gap-xs items-center mt-sm">
            <span className={`badge badge-status-${a.status}`}>{STATUS_LABELS[a.status]}</span>
            <span className="badge badge-heritage">{a.heritage}</span>
            <span className="badge badge-vocation">{title}</span>
          </div>
        </div>
        <div className="adv-header-right">
          <div className="adv-power">
            <span className="label">Power</span>
            <span className="adv-power-num">{a.powerRating}</span>
          </div>
        </div>
      </div>

      <hr className="divider" />

      {/* Appearance */}
      <div className="adv-appearance">
        {a.height} · {a.build} · {a.complexion} complexion · {a.hairColor} hair · {a.eyeColor} eyes
      </div>

      {/* Stats */}
      <div className="adv-stats mt-md">
        {(Object.entries(a.stats) as [string, number][]).map(([stat, val]) => (
          <div key={stat} className="stat-row">
            <span className="label">{stat}</span>
            <div className="stat-bar-track">
              <div className="stat-bar-fill" style={{ width: `${(val / STAT_MAX) * 100}%` }} />
            </div>
            <span className="value">{val}</span>
          </div>
        ))}
      </div>

      {/* Personality */}
      <div className="adv-personality mt-md">
        {(Object.entries(a.personality) as [keyof typeof PERSONALITY_LABELS, number][]).map(([trait, val]) => (
          <div key={trait} className="personality-row">
            <span className="label" style={{ width: 90 }}>{trait}</span>
            <div className="pip-track">
              {[1,2,3,4,5].map(i => (
                <div key={i} className={`pip ${i <= val ? 'filled' : ''}`} />
              ))}
            </div>
            <span className="label">{PERSONALITY_LABELS[trait][val - 1]}</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <hr className="divider" />
      <div className="adv-footer">
        <div className="adv-economics">
          <div><span className="label">Hire Cost</span> <span className="currency">{a.hireCost} gp</span></div>
          <div><span className="label">Daily Wage</span> <span className="currency">{a.dailyWage} gp</span></div>
          <div><span className="label">XP to Next</span> <span className="value">{xpToNext}</span></div>
          {repRequired != null && repRequired > 0 && (
            <div><span className="label">Min. Reputation</span> <span className="value">{repRequired}</span></div>
          )}
        </div>
        <div className="adv-actions">
          {onHire && (
            <button className="btn btn-primary btn-sm" onClick={onHire}>
              Hire — {a.hireCost} gp
            </button>
          )}
          {!onHire && repRequired != null && repRequired > 0 && (
            <span className="label" style={{ fontSize: '0.75rem' }}>Requires {repRequired} rep</span>
          )}
          {onFire && (
            <button className="btn btn-danger btn-sm" onClick={onFire}>
              Release
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  available:    'Available',
  hired:        'On Roster',
  on_adventure: 'Deployed',
  injured:      'Injured',
  dead:         'Deceased',
};
