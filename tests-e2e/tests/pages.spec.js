// Veille anti-bug : chaque page doit se charger sans erreur, sur PC et sur mobile.
// Pour ajouter ou retirer une page, modifie simplement la liste PAGES.
const { test, expect } = require('@playwright/test');

const PAGES = [
  '/index.html',
  '/tarifs.html',
  '/commander.html',
  '/inscription.html',
  '/demarrage.html',
  '/mode-emploi.html',
  '/saisie.html',
];

for (const chemin of PAGES) {
  test(`La page ${chemin} se charge sans erreur`, async ({ page, baseURL }) => {
    const origine = new URL(baseURL).origin;
    const erreursJS = [];
    const fichiersCasses = [];

    // Erreurs JavaScript non rattrapées (le "plantage" d'une page)
    page.on('pageerror', (err) => erreursJS.push(err.message));

    // Fichiers JS / CSS de ton site qui ne répondent pas (404, 500…)
    page.on('response', (rep) => {
      const url = rep.url();
      const type = rep.request().resourceType();
      if (url.startsWith(origine) && ['script', 'stylesheet'].includes(type) && rep.status() >= 400) {
        fichiersCasses.push(`${rep.status()} ${url.replace(origine, '')}`);
      }
    });

    const reponse = await page.goto(chemin, { waitUntil: 'load' });
    expect(reponse, 'le serveur ne répond pas').not.toBeNull();
    expect(reponse.status(), `statut HTTP de ${chemin}`).toBeLessThan(400);

    await page.waitForTimeout(1500); // laisse les scripts démarrer

    expect(fichiersCasses, 'fichiers JS/CSS introuvables').toEqual([]);
    expect(erreursJS, 'erreurs JavaScript sur la page').toEqual([]);
  });
}

test('index.html conserve la balise de vérification Google', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('meta[name="google-site-verification"]'))
    .toHaveAttribute('content', 'VbMO8C8t_FwqGU7sun7NZ_btYfsF6-iVE5r2dx-llho');
});
