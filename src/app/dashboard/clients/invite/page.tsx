// src/app/dashboard/clients/invite/page.tsx
// [UITNODIGING] Doorverwijzing — dit was een tweede, bijna identiek uitnodigscherm.
//
// Het echte scherm is /dashboard/clients/beheer (KlantenBeheer): enkel + bulk uitnodigen, de
// openstaande uitnodigingen mét intrekken, en de gekoppelde klanten — alles op één plek. Dit
// scherm stond nergens in de navigatie (alleen per URL bereikbaar), liep als kopie onvermijdelijk
// achter (zijn uitlegzin stond al in de verkeerde richting: "hij ontvangt een uitnodiging om JOU
// toe te voegen als boekhouder" — terwijl het kantoor de klant uitnodigt), en elke verbetering
// moest twee keer. Zelfde besluit als /dashboard/accountant/status en /werkplek: één bestemming,
// de rest verwijst door. De oude URL blijft werken voor wie hem heeft opgeslagen.
import { redirect } from 'next/navigation'

export default function InvitePage() {
  redirect('/dashboard/clients/beheer')
}
