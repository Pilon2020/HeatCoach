// weather-bootstrap.js
(function () {
  function go(lat, lon) {
    fetch(`/api/weather?lat=${lat}&lon=${lon}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => console.log(`Current temperature (WeatherAPI): ${d.tempC} °C`))
      .catch(() => {/* ignore */});
  }

  function boot() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      pos => go(pos.coords.latitude, pos.coords.longitude),
      () => {}, // denied or error
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
