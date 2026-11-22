import { refresh, signIn, signUp, signOut, deleteAccount, pushSave, pullSave, getUser } from '../shared/cloud.js';
import { mountChrome } from './site-chrome.js';

mountChrome('account');

const $ = sel => document.querySelector(sel);
const status = $('#status');
const say = (msg, isError = false) => { status.textContent = msg; status.classList.toggle('is-error', isError); };

function paint() {
  const u = getUser();
  $('#signed-out').hidden = !!u;
  $('#signed-in').hidden = !u;
  if (u) $('#who').textContent = u.username;
}

let mode = 'login';
document.querySelectorAll('#auth-form button[type="submit"]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; }));

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  if (!form.reportValidity()) return;
  const username = form.username.value.trim();
  const password = form.password.value;
  say(mode === 'signup' ? 'Creating your account…' : 'Signing in…');
  try {
    await (mode === 'signup' ? signUp : signIn)(username, password);
    form.reset();
    paint();
    say(mode === 'signup' ? 'Account created. Your progress is saved.' : 'Signed in. Your progress is synced.');
  } catch (err) { say(err.message, true); }
});

$('#sign-out').addEventListener('click', async () => {
  try { await signOut(); paint(); say('Signed out.'); } catch (err) { say(err.message, true); }
});
$('#sync-now').addEventListener('click', async () => {
  try { await pullSave(); await pushSave(); say('Synced.'); } catch (err) { say(err.message, true); }
});
const box = $('#delete-confirm');
$('#delete-start').addEventListener('click', () => { box.hidden = false; $('#delete-no').focus(); });
$('#delete-no').addEventListener('click', () => { box.hidden = true; $('#delete-start').focus(); say('Your account was not deleted.'); });
$('#delete-yes').addEventListener('click', async () => {
  try { await deleteAccount(); box.hidden = true; paint(); say('Account deleted.'); } catch (err) { say(err.message, true); }
});

refresh().then(paint);
