import { PHOTO_STYLES, googleGranted, type PhotoInfo, type PhotoStyle, type PickStatus } from '../../shared/settings';
import { connectGoogle, googleConnection, startGoogleForPhotos } from './accounts';
import { displaySettings, render, saveDisplay, state } from './store';
import { api, busy, card, field, h, input, quietly, segmented, toast } from './ui';

// The photo frame: how photos are shown, picking them in Google Photos, and the library.

const PHOTOS_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
let photoLibrary: PhotoInfo[] | null = null;
let loadingLibrary = false;
let picking: { sessionId: string; pickerUri: string; status: PickStatus | null } | null = null;

export const PHOTO_LABELS: Record<PhotoStyle, string> = { fill: 'Full screen', framed: 'Framed prints', instant: 'Instant prints', float: 'Borderless' };

/** The number of photos, once the library has loaded (it starts loading on first ask). */
export function photoCount(): number | null {
  if (!photoLibrary && !loadingLibrary && state.status.photos) {
    loadingLibrary = true;
    api<PhotoInfo[]>('/api/admin/photos')
      .then(list => { photoLibrary = list; render(); })
      .catch(err => toast((err as Error).message, 'error'))
      .finally(() => { loadingLibrary = false; });
  }
  return photoLibrary?.length ?? null;
}

export function photoSections(): Node[] {
  const d = displaySettings();
  const style = card('Frame style',
    segmented('photo-style', 'Photo frame style', PHOTO_STYLES.map(s => [s, PHOTO_LABELS[s]] as [PhotoStyle, string]), d.photoStyle ?? 'fill',
      photoStyle => quietly(saveDisplay({ ...d, photoStyle }))),
    h('p', { class: 'hint' }, 'Framed hangs each photo as a mounted print, Instant drops instant-camera prints on a table with a handwritten caption, and Borderless floats them over a blur of their own colours. All three show the place and date. Portrait photos are always shown in pairs.'));

  if (!state.status.photos) {
    return [style, card('Add photos', h('p', { class: 'note' }, 'Photo storage isn’t set up. Run npm run setup again and choose to create the photo bucket (Cloudflare R2, free up to 10 GB).'))];
  }

  // Adding photos needs Google; the library below doesn't, so it can always be tidied.
  const add = card('Add photos', h('p', { class: 'lede' }, 'Pick photos in Google Photos and the hub keeps a copy at screen size for the photo frame. You can open an album in the picker and select everything in it.'));
  const google = googleConnection();
  if (!google?.account) {
    const go = h('a', { href: '#/accounts', class: 'primary button-link' }, 'Set up Google for photos');
    // Photos only, unless they tick more; calendars and tasks are separate choices.
    go.addEventListener('click', startGoogleForPhotos);
    add.append(h('p', { class: 'note' }, 'Photos come from your Google account. Setting it up takes about ten minutes, once; calendars and tasks are optional.'), h('div', { class: 'buttons' }, go));
  } else if (google.scopes && !google.scopes.includes(PHOTOS_SCOPE)) {
    const btn = h('button', { type: 'button', class: 'primary' }, 'Add photos to Google');
    btn.addEventListener('click', () => connectGoogle(btn, { ...(google.wants ?? { calendar: googleGranted(google, 'calendar'), tasks: googleGranted(google, 'tasks'), photos: false }), photos: true }));
    add.append(
      h('p', { class: 'note' }, 'Google is connected without photos. First turn on the ',
        h('a', { href: 'https://console.cloud.google.com/apis/library/photospicker.googleapis.com', target: '_blank', rel: 'noopener' }, 'Photos Picker service'),
        ' in your Google Cloud project, then press below. Google will ask you to allow photo access.'),
      h('div', { class: 'buttons' }, btn));
  } else {
    add.append(picking ? pickingPanel() : pickForm());
  }

  const library = card('Library');
  libraryInto(library);
  return [style, add, library];
}

function pickForm() {
  const collections = [...new Set((photoLibrary ?? []).map(p => p.collection))];
  const collection = input({ type: 'text', value: collections[0] ?? 'Family', maxlength: '40', list: 'collections' });
  const datalist = h('datalist', { id: 'collections' }, ...collections.map(c => h('option', { value: c })));
  const pick = h('button', { type: 'submit', class: 'primary' }, 'Pick photos');
  const form = h('form', { class: 'editform' }, field('Add them to collection', collection, 'Collections help you tidy up later, e.g. “Summer 2026”.'), datalist, h('div', { class: 'buttons' }, pick));
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(pick, async () => {
      const s = await api<{ sessionId: string; pickerUri: string }>('/api/admin/photos/pick', { collection: collection.value || 'Photos' });
      picking = { ...s, status: null };
      render();
      window.open(`${s.pickerUri}/autoclose`, '_blank', 'noopener');
      pollPick();
    });
  });
  return form;
}

function libraryInto(el: HTMLElement) {
  if (!photoLibrary) {
    photoCount();
    el.append(h('p', { class: 'empty' }, 'Loading…'));
    return;
  }
  if (!photoLibrary.length) {
    el.append(h('p', { class: 'empty' }, 'No photos yet, so the photo frame stays out of the rotation.'));
    return;
  }
  const groups = new Map<string, PhotoInfo[]>();
  for (const p of photoLibrary) groups.set(p.collection, [...(groups.get(p.collection) ?? []), p]);
  for (const [name, photos] of groups) {
    const removeAll = h('button', { type: 'button', class: 'ghost small danger' }, 'Remove collection');
    removeAll.addEventListener('click', () => {
      if (!confirm(`Remove all ${photos.length} photos in “${name}” from the frame? They stay in Google Photos.`)) return;
      busy(removeAll, async () => { photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/delete', { collection: name }); render(); toast('Removed.'); });
    });
    // A place for the whole collection. Google's picker never shares where a photo was taken,
    // so the frame's label is whatever is typed here (or per photo, by tapping it).
    const shared = photos.every(p => p.caption === photos[0].caption) ? photos[0].caption ?? '' : '';
    const place = input({ type: 'text', value: shared, maxlength: '60', placeholder: 'e.g. St Ives, Cornwall', 'aria-label': `Place for ${name}` });
    const savePlace = h('button', { type: 'submit', class: 'ghost small' }, 'Label all');
    const placeForm = h('form', { class: 'searchrow placerow' }, place, savePlace);
    placeForm.addEventListener('submit', e => {
      e.preventDefault();
      busy(savePlace, async () => {
        photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/caption', { collection: name, caption: place.value });
        render();
        toast(place.value.trim() ? `All of “${name}” labelled “${place.value.trim()}”.` : 'Labels cleared.');
      });
    });

    const grid = h('div', { class: 'thumbs' });
    for (const p of photos.slice(0, 48)) {
      const del = h('button', { type: 'button', class: 'thumb-del', 'aria-label': 'Remove this photo' });
      del.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      del.addEventListener('click', () => busy(del, async () => { photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/delete', { ids: [p.id] }); render(); }));
      const edit = h('button', { type: 'button', class: 'thumb-edit', 'aria-label': p.caption ? `Label: ${p.caption}. Change it` : 'Add a label to this photo' },
        h('img', { src: `/api/admin/photos/thumb/${p.id}`, alt: '', loading: 'lazy' }));
      edit.addEventListener('click', async () => {
        const next = prompt('Label for this photo (a place, or who’s in it). Leave empty to remove.', p.caption ?? '');
        if (next === null) return;
        try {
          photoLibrary = await api<PhotoInfo[]>('/api/admin/photos/caption', { ids: [p.id], caption: next });
          render();
        } catch (err) { toast((err as Error).message, 'error'); }
      });
      grid.append(h('figure', { class: 'thumb' }, edit, del, p.caption ? h('figcaption', {}, p.caption) : null));
    }
    el.append(h('div', { class: 'collection' },
      h('div', { class: 'collection-head' }, h('b', {}, name), h('small', {}, `${photos.length} photo${photos.length === 1 ? '' : 's'}`), removeAll),
      placeForm,
      grid,
      h('p', { class: 'hint' }, 'Tap a photo to label it on its own.'),
      photos.length > 48 ? h('p', { class: 'hint' }, `Showing 48 of ${photos.length}.`) : null,
    ));
  }
}

function pickingPanel() {
  const p = picking!;
  const s = p.status;
  const line = !s || s.state === 'waiting'
    ? 'Waiting for you to choose photos in Google Photos. Press Done there when you’ve finished.'
    : s.state === 'importing' ? `Copying photos… ${s.imported} of ${s.total}`
    : s.state === 'done' ? `Done: ${s.imported} photo${s.imported === 1 ? '' : 's'} added${s.skipped ? ` (${s.skipped} skipped: videos or unreadable)` : ''}.`
    : 'That picking session expired. Start again.';
  const open = h('a', { class: 'ghost button-link', href: `${p.pickerUri}/autoclose`, target: '_blank', rel: 'noopener' }, 'Open Google Photos');
  const cancel = h('button', { type: 'button', class: 'ghost' }, s && (s.state === 'done' || s.state === 'expired') ? 'Close' : 'Cancel');
  cancel.addEventListener('click', () => { picking = null; render(); });
  const progress = s?.state === 'importing' && s.total ? h('progress', { max: String(s.total), value: String(s.imported) }) : null;
  return h('div', { class: 'panel' },
    h('p', { class: `result ${s?.state === 'expired' ? 'bad' : 'good'}` }, line),
    progress,
    h('div', { class: 'buttons' }, !s || s.state === 'waiting' ? open : null, cancel),
  );
}

async function pollPick() {
  while (picking && (!picking.status || picking.status.state === 'waiting' || picking.status.state === 'importing')) {
    const current = picking;
    try {
      current.status = await api<PickStatus>('/api/admin/photos/poll', { sessionId: current.sessionId });
    } catch (err) {
      toast((err as Error).message, 'error');
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (picking !== current) return; // cancelled
    if (current.status.state === 'done') photoLibrary = null; // reload the library
    render();
    const wait = current.status.state === 'waiting' ? current.status.pollMs : 300;
    await new Promise(r => setTimeout(r, wait));
  }
}
