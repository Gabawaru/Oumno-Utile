// La clé publique VAPID, que le navigateur doit connaître pour s'abonner.
// Publique par construction — c'est la privée, dans les variables d'environnement,
// qui prouve que la poussée vient bien de ce service.
export default function handler(req, res) {
  const cle = process.env.VAPID_PUBLIC;
  if (!cle) { res.status(503).json({ error: "VAPID_PUBLIC absente" }); return; }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({ cle });
}
