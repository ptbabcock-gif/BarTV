// Demo data so a new user can see what The Cheers looks like once filled in. All ratings are fictional.
export function sampleState() {
  const v = (id, name, city, address, lat, lng) => ({ id, name, city, address, lat, lng });
  const t = (id, venueId, date, price, scores, ingredients, notes, wouldOrderAgain) =>
    ({ id, venueId, date, price, scores, ingredients, notes, wouldOrderAgain });
  return {
    venues: [
      v('smp-termini', 'Bar Termini', 'London', '7 Old Compton St, Soho, London', 51.5134, -0.1316),
      v('smp-dante', 'Dante', 'New York', '79-81 MacDougal St, Greenwich Village, New York', 40.7297, -74.0011),
      v('smp-soho', 'The Soho Grind', 'London', '19 Beak St, Soho, London', 51.5120, -0.1372),
      v('smp-chain', 'Generic Hotel Bar', 'London', 'Park Lane, London', 51.5073, -0.1517),
      v('smp-maybe', 'Maybe Sammy', 'Sydney', '115 Harrington St, The Rocks, Sydney', -33.8599, 151.2075),
    ],
    tastings: [
      t('smp-1', 'smp-termini', '2026-09-12', 14, { coffee: 5, balance: 5, foam: 5, presentation: 4, temperature: 5 },
        { vodka: 'Ketel One', coffee: 'Fresh espresso', liqueur: 'Mr Black', sweetener: 'Demerara syrup', garnish: '3 coffee beans', extras: [] },
        'Dense, glossy foam. Espresso pulled to order. Benchmark.', true),
      t('smp-2', 'smp-termini', '2026-10-03', 14, { coffee: 5, balance: 4, foam: 5, presentation: 5, temperature: 4 },
        { vodka: 'Ketel One', coffee: 'Fresh espresso', liqueur: 'Mr Black', sweetener: 'Demerara syrup', garnish: '3 coffee beans', extras: [] },
        'Slightly sweeter batch tonight, still superb.', true),
      t('smp-3', 'smp-dante', '2026-08-21', 19, { coffee: 4, balance: 5, foam: 4, presentation: 5, temperature: 5 },
        { vodka: 'Grey Goose', coffee: 'Cold brew', liqueur: 'Galliano Ristretto', sweetener: 'Vanilla syrup', garnish: 'Cocoa dust', extras: ['Chocolate bitters'] },
        'Vanilla forward. Pricey but a lovely glass.', true),
      t('smp-4', 'smp-soho', '2026-10-10', 11, { coffee: 4, balance: 3, foam: 3, presentation: 3, temperature: 4 },
        { vodka: 'House vodka', coffee: 'Fresh espresso', liqueur: 'Kahlúa', sweetener: 'Simple syrup', garnish: '3 coffee beans', extras: [] },
        'Good coffee, a touch too sweet, foam faded fast.', true),
      t('smp-5', 'smp-chain', '2026-07-30', 17, { coffee: 2, balance: 2, foam: 1, presentation: 3, temperature: 3 },
        { vodka: 'Smirnoff', coffee: 'Espresso shot (bottled)', liqueur: 'Kahlúa', sweetener: 'Simple syrup', garnish: 'None', extras: [] },
        'Flat, watery, no foam. Bottled espresso.', false),
      t('smp-6', 'smp-maybe', '2026-05-18', 24, { coffee: 5, balance: 4, foam: 4, presentation: 5, temperature: 5 },
        { vodka: 'Belvedere', coffee: 'Nitro cold brew', liqueur: 'Mr Black', sweetener: 'Salted caramel', garnish: 'Chocolate shavings', extras: ['Sea salt'] },
        'Theatrical pour. Salted caramel works better than it should.', true),
    ],
  };
}
