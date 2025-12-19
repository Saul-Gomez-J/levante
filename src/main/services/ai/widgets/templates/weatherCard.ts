/**
 * Weather Card Widget Template
 */

import { escapeHtml } from '../htmlUtils';

/**
 * Get weather emoji based on condition
 */
export function getWeatherEmoji(condition: string): string {
  const c = (condition || '').toLowerCase();
  if (c.includes('sun') || c.includes('clear')) return '☀️';
  if (c.includes('cloud') || c.includes('overcast')) return '☁️';
  if (c.includes('partly')) return '⛅';
  if (c.includes('rain') || c.includes('shower')) return '🌧️';
  if (c.includes('thunder') || c.includes('storm')) return '⛈️';
  if (c.includes('snow')) return '❄️';
  if (c.includes('fog') || c.includes('mist')) return '🌫️';
  if (c.includes('wind')) return '💨';
  return '🌤️';
}

/**
 * Generate Weather card widget HTML
 */
export function generateWeatherCardHtml(data: Record<string, any>): string {
  const { city, condition, temperature, unit, humidity, timestamp } = data;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 20px;
      padding: 30px;
      width: 100%;
      max-width: 350px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }
    .city {
      font-size: 24px;
      font-weight: 600;
      color: #333;
      margin-bottom: 5px;
    }
    .timestamp {
      font-size: 12px;
      color: #888;
      margin-bottom: 20px;
    }
    .temp-container {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
    }
    .temp {
      font-size: 64px;
      font-weight: 300;
      color: #333;
    }
    .unit {
      font-size: 24px;
      color: #666;
      margin-left: 5px;
      align-self: flex-start;
      margin-top: 10px;
    }
    .condition {
      font-size: 18px;
      color: #666;
      text-transform: capitalize;
      margin-bottom: 20px;
    }
    .details {
      display: flex;
      gap: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .detail-item {
      text-align: center;
    }
    .detail-label {
      font-size: 12px;
      color: #888;
      margin-bottom: 5px;
    }
    .detail-value {
      font-size: 16px;
      font-weight: 500;
      color: #333;
    }
    .weather-icon {
      font-size: 48px;
      margin-left: auto;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="city">${escapeHtml(city || 'Unknown')}</div>
    <div class="timestamp">${escapeHtml(timestamp || new Date().toLocaleString())}</div>
    <div class="temp-container">
      <span class="temp">${escapeHtml(String(temperature ?? '--'))}</span>
      <span class="unit">${escapeHtml(unit || '°C')}</span>
      <span class="weather-icon">${getWeatherEmoji(condition)}</span>
    </div>
    <div class="condition">${escapeHtml(condition || 'Unknown')}</div>
    <div class="details">
      <div class="detail-item">
        <div class="detail-label">Humidity</div>
        <div class="detail-value">${escapeHtml(String(humidity ?? '--'))}${typeof humidity === 'number' ? '%' : ''}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
