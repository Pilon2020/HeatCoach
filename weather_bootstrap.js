// weather-bootstrap.js
(function () {
  function fetchAndLogWeather(lat, lon) {
    fetch(`/api/weather?lat=${lat}&lon=${lon}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        // Also log to browser console for convenience
        console.log(`Current temperature (WeatherAPI): ${data.tempC} °C`);
      })
      .catch(() => {});
  }

  function bootstrapWeatherOnLoad() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        fetchAndLogWeather(latitude, longitude);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapWeatherOnLoad, { once: true });
  } else {
    bootstrapWeatherOnLoad();
  }
})();
