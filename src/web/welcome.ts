import { runOnboarding } from './onboarding';
import { h } from './screen';

// Shown when this device isn't signed in yet. The admin password signs it in here, so the
// display just opens from now on; on a brand-new hub it leads into a short setup.
//
// On iPhone and iPad, Safari and a Home Screen app keep separate sign-ins, so when this is
// open in Safari (not yet added to the Home Screen) we suggest adding it first, to sign in once.

const isAppleTouch = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isHomeScreenApp = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

export async function showWelcome(root: HTMLElement, onReady: () => void) {
  const fresh = await fetch('/api/welcome').then(r => r.json()).then(d => !!d.fresh).catch(() => false);

  const password = h('input');
  Object.assign(password, { type: 'password', autocomplete: 'current-password', required: true, id: 'pair-password' });
  const label = h('label', 'wel-label', 'Admin password');
  label.htmlFor = 'pair-password';
  const submit = h('button', 'wel-primary', fresh ? 'Get started' : 'Sign in');
  submit.type = 'submit';
  const error = h('p', 'wel-error');
  error.setAttribute('role', 'alert');
  const form = h('form', 'wel-form');
  form.append(label, password, error, submit);

  const card = h('section', 'wel-card');
  if (isAppleTouch() && !isHomeScreenApp()) {
    const tip = h('p', 'wel-tip');
    tip.append(h('b', undefined, 'Tip: '), 'add this to your Home Screen first (Share → Add to Home Screen) and open it from there. It then runs full screen, and you only sign in once.');
    card.append(tip);
  }
  card.append(
    h('h1', undefined, fresh ? 'Welcome to Home&Sky Hub' : 'Sign in to this screen'),
    h('p', 'wel-lede', fresh
      ? 'Enter the admin password you got when you ran setup. Then answer three quick questions and your screen is ready.'
      : 'Enter the admin password. This screen stays signed in from now on.'),
    form,
  );
  root.replaceChildren(card);
  root.hidden = false;
  root.className = 'welcome';
  password.focus();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: password.value }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; fresh?: boolean };
      if (!res.ok) throw new Error(data.error ?? 'That didn’t work. Try again.');
      if (data.fresh) return runOnboarding(root, onReady);
      root.hidden = true;
      root.className = '';
      onReady();
    } catch (err) {
      error.textContent = (err as Error).message;
      submit.disabled = false;
      password.select();
    }
  });
}
