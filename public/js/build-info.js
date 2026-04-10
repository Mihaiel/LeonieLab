// Populates the footer's #build-info span with the deploy-time commit hash
// and timestamp written by ./deploy.sh into /resources/build.json. When the
// file is missing (e.g. local dev), the span falls back to "Built locally".
(function () {
  const el = document.getElementById('build-info');
  if (!el) return;

  fetch('/resources/build.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (build) {
      if (!build || !build.hash || !build.date) return;

      const d = new Date(build.date);
      const formatted = d.toLocaleString('en-US', {
        month:   'short',
        day:     'numeric',
        year:    'numeric',
        hour:    'numeric',
        minute:  '2-digit',
        hour12:  true,
        timeZone: 'UTC',
      }) + ' UTC';

      const link = document.createElement('a');
      link.href = 'https://github.com/Mihaiel/LeonieLab/commit/' + build.hash;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = build.hash;

      el.textContent = 'Built ' + formatted + ' (';
      el.appendChild(link);
      el.appendChild(document.createTextNode(')'));
    })
    .catch(function () { /* keep the fallback "Built locally" */ });
})();
