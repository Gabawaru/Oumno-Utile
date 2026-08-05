#!/usr/bin/env node
// Base de démonstration (mot de passe : demo1234), puis lancement du serveur.
// Usage : npm run demo   —  supprimez data/demo.db pour repartir de zéro.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.CRENEAU_DATA || join(ROOT, 'data', 'demo.db');
process.env.CRENEAU_DATA = DB_PATH;

const fresh = !existsSync(DB_PATH);
const { openDb, setSettings, setRawSetting } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

if (fresh) {
  const db = openDb(DB_PATH);
  setRawSetting(db, 'auth', hashPassword('demo1234'));
  setSettings(db, {
    organizer_name: 'Dr. Camille Martin',
    organizer_email: 'camille@example.fr',
    timezone: 'Europe/Paris',
    page_title: 'Prendre rendez-vous avec Camille Martin',
    page_intro: 'Choisissez le type de rendez-vous, puis un créneau qui vous convient. La confirmation arrive immédiatement.',
    brand_color: '#0d9488',
  });

  const insType = db.prepare(
    `INSERT INTO event_types (slug, name, description, duration_min, buffer_after_min, min_notice_min,
      max_days_ahead, daily_max, location_type, location_detail, color, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insType.run('premiere-consultation', 'Première consultation', 'Bilan initial et échange sur vos besoins.', 45, 15, 720, 45, 4, 'video', 'Lien visio envoyé après réservation', '#0d9488', 1);
  insType.run('suivi-30-min', 'Rendez-vous de suivi', 'Point de suivi pour les patients déjà accompagnés.', 30, 10, 240, 30, 6, 'video', '', '#2563eb', 2);
  insType.run('appel-decouverte', 'Appel découverte (15 min)', 'Court échange téléphonique, sans engagement.', 15, 5, 120, 21, 0, 'phone', 'Je vous appelle au numéro indiqué', '#7c3aed', 3);

  // Disponibilités globales : lun–ven, 9h–12h30 et 14h–18h ; sam 10h–13h.
  const insRule = db.prepare('INSERT INTO availability_rules (event_type_id, weekday, start_min, end_min) VALUES (NULL, ?, ?, ?)');
  for (const wd of [1, 2, 3, 4, 5]) { insRule.run(wd, 9 * 60, 12 * 60 + 30); insRule.run(wd, 14 * 60, 18 * 60); }
  insRule.run(6, 10 * 60, 13 * 60);

  // Une réservation d'exemple : demain 10:00 Paris pour le suivi.
  const { dateAndMinutesToUtc, localDateStr, addDays } = await import('../src/timezone.js');
  const tomorrow = addDays(localDateStr(new Date(), 'Europe/Paris'), 1);
  const start = dateAndMinutesToUtc(tomorrow, 10 * 60, 'Europe/Paris');
  const end = new Date(start.getTime() + 30 * 60000);
  db.prepare(
    `INSERT INTO bookings (uid, event_type_id, start_utc, end_utc, invitee_name, invitee_email, invitee_tz, invitee_notes, manage_token)
     VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`${randomUUID()}@creneau`, start.toISOString(), end.toISOString(), 'Jean Dupont', 'jean@example.com', 'Europe/Paris', 'Suivi mensuel', randomBytes(18).toString('base64url'));

  console.log(`Base de démonstration créée : ${DB_PATH}`);
  console.log('Mot de passe admin : demo1234');
  db.close();
} else {
  console.log(`Base existante réutilisée : ${DB_PATH} (mot de passe : demo1234)`);
}

const { createApp } = await import('../server.js');
const { server } = createApp(DB_PATH);
const PORT = Number(process.env.PORT || 3222);
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`Créneau (démo) : http://${HOST}:${PORT}`);
  console.log(`Console admin : http://${HOST}:${PORT}/#/admin`);
});
