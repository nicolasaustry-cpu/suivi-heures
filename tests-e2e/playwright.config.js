// Configuration de la veille anti-bug Suiv'Heures
// L'adresse testée vient de la variable BASE_URL (réglée dans GitHub, pas ici).
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  throw new Error("BASE_URL manquant : renseigne la variable BASE_URL dans GitHub (ex. https://ton-domaine.fr)");
}

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1, // un 2e essai évite une fausse alerte si Railway répond lentement
  // 'github' publie chaque erreur en annotation lisible par Claude via l'API GitHub
  reporter: [['list'], ['github'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pc', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
