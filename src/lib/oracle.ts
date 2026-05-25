export interface OracleKey {
  dataType: 'rainfall' | 'temperature' | 'flight' | 'defi';
  location?: string;
  flightNumber?: string;
  period?: string;
}

export function parseOracleKey(key: string): OracleKey {
  if (key.startsWith('rainfall:')) {
    const [, coords, period] = key.split(':');
    return { dataType: 'rainfall', location: coords, period };
  }
  if (key.startsWith('temperature:')) {
    const [, coords, period] = key.split(':');
    return { dataType: 'temperature', location: coords, period };
  }
  if (key.startsWith('flight:')) {
    const [, flightNumber, date] = key.split(':');
    return { dataType: 'flight', flightNumber, period: date };
  }
  return { dataType: 'defi' };
}

export function oracleKeyLabel(key: string): string {
  const parsed = parseOracleKey(key);
  switch (parsed.dataType) {
    case 'rainfall':
      return `Rainfall · ${parsed.location ?? ''} · ${parsed.period ?? ''}`;
    case 'temperature':
      return `Temperature · ${parsed.location ?? ''} · ${parsed.period ?? ''}`;
    case 'flight':
      return `Flight ${parsed.flightNumber ?? ''} · ${parsed.period ?? ''}`;
    default:
      return key;
  }
}

export function oracleValueUnit(dataType: string): string {
  if (dataType === 'rainfall')    return 'mm';
  if (dataType === 'temperature') return '°C';
  if (dataType === 'flight')      return 'min';
  return '';
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 90) return 'High';
  if (confidence >= 70) return 'Medium';
  return 'Low';
}

export function confidenceColour(confidence: number): string {
  if (confidence >= 90) return 'text-emerald-400';
  if (confidence >= 70) return 'text-amber-400';
  return 'text-red-400';
}

export function buildRainfallKey(lat: number, lng: number, year: number, month: number): string {
  const monthStr = String(month).padStart(2, '0');
  return `rainfall:${lat},${lng}:${year}-${monthStr}`;
}

export function buildFlightKey(flightNumber: string, date: string): string {
  return `flight:${flightNumber}:${date}`;
}
