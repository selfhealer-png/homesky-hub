import { h } from './screen';

// Shown when this device isn't paired yet. On a brand-new hub it's a welcome; otherwise a
// plain "pair this display". Either way the admin password pairs it right here, which also
// signs in to setup. That is the way back in on iPhone and iPad, where Safari and a Home Screen
// app don't share cookies: pairing in Safari never reaches the app.

export async function showWelcome(root: HTMLElement, onPaired: () => void) {
  const fresh = await fetch('/api/welcome').then(r => r.json()).then(d => !!d.fresh).catch(() => false);

  const password = h('input');
  Object.assign(password, { type: 'password', autocomplete: 'current-password', required: true, id: 'pair-password' });
  const label = h('label', 'wel-label', 'Admin password');
  label.htmlFor = 'pair-password';
  const submit = h('button', 'wel-primary', fresh ? 'Get started' : 'Pair this display');
  submit.type = 'submit';
  const error = h('p', 'wel-error');
  error.setAttribute('role', 'alert');
  const form = h('form', 'wel-form');
  form.append(label, password, error, submit);

  const card = h('section', 'wel-card');
  card.append(
    h('h1', undefined, fresh ? 'Welcome to Home&Sky Hub' : 'Pair this display'),
    h('p', 'wel-lede', fresh
      ? 'Your hub is running. Enter the admin password from the setup wizard to use this screen, then add your calendars, photos and places.'
      : 'Enter the admin password to let this screen show your hub. You only need to do this once on each device.'),
    form,
    h('p', 'wel-note', 'On iPhone and iPad, the Home Screen app and Safari sign in separately, so pair again after adding the hub to your Home Screen.'),
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
      if (!res.ok) throw new Error(data.error ?? 'Pairing didn’t work. Try again.');
      if (data.fresh) return showNextSteps(root, onPaired);
      root.hidden = true;
      root.className = '';
      onPaired();
    } catch (err) {
      error.textContent = (err as Error).message;
      submit.disabled = false;
      password.select();
    }
  });
}

function showNextSteps(root: HTMLElement, onPaired: () => void) {
  const setup = h('a', 'wel-primary', 'Open setup');
  setup.href = '/setup';
  const start = h('button', 'wel-secondary', 'Show the display');
  start.type = 'button';
  start.addEventListener('click', () => { root.hidden = true; root.className = ''; onPaired(); });
  const card = h('section', 'wel-card');
  card.append(
    h('h1', undefined, 'This display is paired'),
    h('p', 'wel-lede', 'Next, add what it should show. Setup has step-by-step guides for each part, and you’re already signed in.'),
    h('ul', 'wel-steps'),
    h('div', 'wel-actions'),
  );
  const steps = card.querySelector('.wel-steps')!;
  for (const s of ['Calendars and tasks: from Google, iCloud, Outlook or a calendar link', 'Photos for the photo frame', 'Your places for the weather and radar', 'Clock style and how much it moves']) steps.append(h('li', undefined, s));
  card.querySelector('.wel-actions')!.append(setup, start);
  root.replaceChildren(card);
}
