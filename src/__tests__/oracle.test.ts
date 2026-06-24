import {
  parseOracleKey,
  oracleKeyLabel,
  buildRainfallKey,
  buildFlightKey,
  confidenceLabel,
  confidenceColour,
} from '../lib/oracle';

describe('parseOracleKey', () => {
  it('parses rainfall keys', () => {
    const result = parseOracleKey('rainfall:-0.0917,34.7679:2026-06');
    expect(result.dataType).toBe('rainfall');
    expect(result.location).toBe('-0.0917,34.7679');
    expect(result.period).toBe('2026-06');
  });

  it('parses flight keys', () => {
    const result = parseOracleKey('flight:KQ100:2026-06-01');
    expect(result.dataType).toBe('flight');
    expect(result.flightNumber).toBe('KQ100');
    expect(result.period).toBe('2026-06-01');
  });

  it('handles unknown keys as defi', () => {
    expect(parseOracleKey('unknown:key').dataType).toBe('defi');
  });

  it('parses defi keys', () => {
    const bare = parseOracleKey('defi');
    expect(bare.dataType).toBe('defi');
    expect(bare.defiKey).toBeUndefined();

    const keyed = parseOracleKey('defi:protocol-monitor');
    expect(keyed.dataType).toBe('defi');
    expect(keyed.defiKey).toBe('protocol-monitor');
  });
});

describe('buildRainfallKey', () => {
  it('builds the correct key format', () => {
    const key = buildRainfallKey(-0.0917, 34.7679, 2026, 6);
    expect(key).toBe('rainfall:-0.0917,34.7679:2026-06');
  });

  it('pads single-digit months', () => {
    const key = buildRainfallKey(0, 0, 2026, 3);
    expect(key).toContain('2026-03');
  });
});

describe('buildFlightKey', () => {
  it('builds the correct flight key', () => {
    expect(buildFlightKey('KQ100', '2026-06-01')).toBe('flight:KQ100:2026-06-01');
  });
});

describe('oracleKeyLabel', () => {
  it('formats bare defi keys', () => {
    expect(oracleKeyLabel('defi')).toBe('DeFi Exploit Monitor');
  });

  it('formats keyed defi keys', () => {
    expect(oracleKeyLabel('defi:protocol-monitor')).toBe('DeFi · protocol-monitor');
  });
});

describe('confidenceLabel', () => {
  it('returns High for 90+', () => { expect(confidenceLabel(90)).toBe('High'); });
  it('returns Medium for 70-89', () => { expect(confidenceLabel(75)).toBe('Medium'); });
  it('returns Low for below 70', () => { expect(confidenceLabel(50)).toBe('Low'); });
});

describe('confidenceColour', () => {
  it('returns emerald for high confidence', () => {
    expect(confidenceColour(95)).toBe('text-emerald-400');
  });
  it('returns amber for medium confidence', () => {
    expect(confidenceColour(80)).toBe('text-amber-400');
  });
  it('returns red for low confidence', () => {
    expect(confidenceColour(60)).toBe('text-red-400');
  });
});
