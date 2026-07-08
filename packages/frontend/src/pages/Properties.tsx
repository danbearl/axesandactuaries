import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { PropertyType } from '@axes-actuaries/types';
import { useState } from 'react';
import './Properties.css';

const PROPERTY_CATALOG: {
  type: PropertyType;
  name: string;
  description: string;
  baseCost: number;
  baseMaintenanceDaily: number;
  bonusSummary: string;
}[] = [
  {
    type: 'dormitory',
    name: 'Dormitory',
    description: 'Living quarters for your adventurers. Determines how many you can keep on the roster at once — build or upgrade to make room for a bigger guild.',
    baseCost: 200,
    baseMaintenanceDaily: 15,
    bonusSummary: '+4 roster capacity per level',
  },
  {
    type: 'training_hall',
    name: 'Training Hall',
    description: 'A dedicated space for combat drills, physical conditioning, and skill refinement. Increases power rating and XP gain.',
    baseCost: 350,
    baseMaintenanceDaily: 20,
    bonusSummary: '+Power Rating, +XP per level',
  },
  {
    type: 'infirmary',
    name: 'Infirmary',
    description: 'Medical facilities reduce injury recovery time. Essential for any guild that sends parties on dangerous contracts.',
    baseCost: 300,
    baseMaintenanceDaily: 18,
    bonusSummary: '-15% injury recovery time per level',
  },
  {
    type: 'library',
    name: 'Library',
    description: 'A collection of lore, maps, and strategic texts. Chroniclers gain additional bonuses here; all adventurers gain Cunning.',
    baseCost: 400,
    baseMaintenanceDaily: 25,
    bonusSummary: '+Cunning, Chronicler bonus per level',
  },
  {
    type: 'alchemy_lab',
    name: 'Alchemy Laboratory',
    description: 'A workspace for compound preparation. Alchemists thrive here; all adventurers benefit from pre-contract preparations.',
    baseCost: 500,
    baseMaintenanceDaily: 30,
    bonusSummary: '+Party buffs, Alchemist bonus per level',
  },
  {
    type: 'armory',
    name: 'Armory',
    description: 'Weapons, armor, and equipment storage. Reduces effective hire costs for Sellswords and improves Might for combat contracts.',
    baseCost: 450,
    baseMaintenanceDaily: 22,
    bonusSummary: '+Might, wage discount for combat vocations',
  },
];

const UPGRADE_COSTS: Record<number, number> = { 1: 150, 2: 350, 3: 700 };

export default function Properties() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: playerData } = useQuery({
    queryKey: ['player'],
    queryFn: () => api.player.me(),
  });

  const { data: propertiesData, isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.properties.list(),
  });

  const buildMutation = useMutation({
    mutationFn: (type: string) => api.properties.build(type),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['player'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Build failed'),
  });

  const sellMutation = useMutation({
    mutationFn: (id: string) => api.properties.sell(id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['player'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Sale failed'),
  });

  const upgradeMutation = useMutation({
    mutationFn: (id: string) => api.properties.upgrade(id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['player'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upgrade failed'),
  });

  const gold = playerData?.player.gold ?? 0;
  const properties = propertiesData?.properties ?? [];
  const ownedTypes = new Set(properties.map(p => p.type));
  const dailyMaintenance = properties.reduce((s, p) => s + p.maintenanceCostDaily, 0);

  return (
    <div className="properties-page">
      <div className="page-header">
        <h1>Properties</h1>
        <span className="label">Guild facilities and infrastructure</span>
      </div>

      {error && (
        <div className="panel panel-sm" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="properties-summary panel panel-sm">
        <div className="flex gap-lg items-center">
          <div><span className="label">Treasury</span><br /><span className="currency">{gold.toLocaleString()} gp</span></div>
          <div><span className="label">Daily Maintenance</span><br /><span className="currency negative">{dailyMaintenance} gp/day</span></div>
          <div><span className="label">Properties Owned</span><br /><span className="value">{properties.length}</span></div>
        </div>
      </div>

      {isLoading && <div className="empty-state">Loading properties…</div>}

      {/* Owned properties */}
      {properties.length > 0 && (
        <section>
          <h2 className="mb-md">Your Facilities</h2>
          <div className="grid-2">
            {properties.map(prop => {
              const catalog = PROPERTY_CATALOG.find(c => c.type === prop.type)!;
              const upgradeCost = UPGRADE_COSTS[prop.level];
              const canUpgrade = prop.level < 3 && upgradeCost !== undefined && gold >= upgradeCost;
              return (
                <div key={prop.id} className="panel owned-property">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3>{catalog?.name ?? prop.type}</h3>
                      <div className="level-pips flex gap-xs mt-sm">
                        {[1,2,3].map(l => (
                          <div key={l} className={`level-pip ${l <= prop.level ? 'active' : ''}`} />
                        ))}
                        <span className="label">Level {prop.level}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="currency negative">{prop.maintenanceCostDaily} gp/day</div>
                    </div>
                  </div>

                  {catalog && <p className="mt-sm">{catalog.description}</p>}

                  <div className="property-bonus mt-sm">
                    <span className="label">Bonus:</span> <span className="value">{catalog?.bonusSummary}</span>
                  </div>

                  <div className="mt-md flex justify-between items-center">
                    {prop.level < 3 ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={!canUpgrade || upgradeMutation.isPending}
                        title={!canUpgrade ? `Requires ${upgradeCost} gp` : undefined}
                        onClick={() => upgradeMutation.mutate(prop.id)}
                      >
                        Upgrade to Level {prop.level + 1} — {upgradeCost} gp
                      </button>
                    ) : (
                      <span className="badge badge-vocation">MAX LEVEL</span>
                    )}
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={sellMutation.isPending}
                      title={`Sell for ${Math.max(1, Math.floor((prop.costBasis || catalog.baseCost) / 2))} gp (50% of cost)`}
                      onClick={() => {
                        if (window.confirm(`Sell ${catalog?.name ?? prop.type} for ${Math.max(1, Math.floor((prop.costBasis || catalog.baseCost) / 2))} gp? This cannot be undone.`)) {
                          sellMutation.mutate(prop.id);
                        }
                      }}
                    >
                      Sell — {Math.max(1, Math.floor((prop.costBasis || catalog.baseCost) / 2))} gp
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Build new */}
      <section>
        <h2 className="mb-md">Build New Facility</h2>
        <div className="grid-2">
          {PROPERTY_CATALOG.filter(c => !ownedTypes.has(c.type)).map(catalog => (
            <div key={catalog.type} className="panel catalog-card">
              <div className="flex justify-between items-center">
                <h3>{catalog.name}</h3>
                <span className="currency">{catalog.baseCost} gp</span>
              </div>
              <p className="mt-sm">{catalog.description}</p>
              <div className="property-bonus mt-sm">
                <span className="label">Benefit:</span> <span className="value">{catalog.bonusSummary}</span>
              </div>
              <div className="mt-md flex justify-between items-center">
                <span className="label">{catalog.baseMaintenanceDaily} gp/day maintenance</span>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={gold < catalog.baseCost || buildMutation.isPending}
                  onClick={() => buildMutation.mutate(catalog.type)}
                >
                  Build
                </button>
              </div>
            </div>
          ))}
          {PROPERTY_CATALOG.every(c => ownedTypes.has(c.type)) && (
            <div className="empty-state">All facility types constructed.</div>
          )}
        </div>
      </section>
    </div>
  );
}
