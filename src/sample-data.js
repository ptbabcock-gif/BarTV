// Demo data so a new user can see what The Cheers looks like once filled in. All ratings are fictional.
export function sampleState() {
  const v = (id, name, city, address, lat, lng) => ({ id, name, city, address, lat, lng });
  const t = (id, venueId, date, price, scores, ingredients, notes, wouldOrderAgain) =>
    ({ id, venueId, date, price, scores, ingredients, notes, wouldOrderAgain });
  return {
    venues: [
      v('a1000000-0000-4000-8000-000000000001', 'Bar Termini', 'London', '7 Old Compton St, Soho, London', 51.5134, -0.1316),
      v('a1000000-0000-4000-8000-000000000002', 'Dante', 'New York', '79-81 MacDougal St, Greenwich Village, New York', 40.7297, -74.0011),
      v('a1000000-0000-4000-8000-000000000003', 'The Soho Grind', 'London', '19 Beak St, Soho, London', 51.5120, -0.1372),
      v('a1000000-0000-4000-8000-000000000004', 'Generic Hotel Bar', 'London', 'Park Lane, London', 51.5073, -0.1517),
      v('a1000000-0000-4000-8000-000000000005', 'Maybe Sammy', 'Sydney', '115 Harrington St, The Rocks, Sydney', -33.8599, 151.2075),
    ],
    tastings: [
      t('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '2026-09-12', 14, { coffee: 5, balance: 5, foam: 5, presentation: 4, temperature: 5 },
        { vodka: 'Ketel One', coffee: 'Fresh espresso', liqueur: 'Mr Black', sweetener: 'Demerara syrup', garnish: '3 coffee beans', extras: [] },
        'Dense, glossy foam. Espresso pulled to order. Benchmark.', true),
      t('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '2026-10-03', 14, { coffee: 5, balance: 4, foam: 5, presentation: 5, temperature: 4 },
        { vodka: 'Ketel One', coffee: 'Fresh espresso', liqueur: 'Mr Black', sweetener: 'Demerara syrup', garnish: '3 coffee beans', extras: [] },
        'Slightly sweeter batch tonight, still superb.', true),
      t('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', '2026-08-21', 19, { coffee: 4, balance: 5, foam: 4, presentation: 5, temperature: 5 },
        { vodka: 'Grey Goose', coffee: 'Cold brew', liqueur: 'Galliano Ristretto', sweetener: 'Vanilla syrup', garnish: 'Cocoa dust', extras: ['Chocolate bitters'] },
        'Vanilla forward. Pricey but a lovely glass.', true),
      t('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', '2026-10-10', 11, { coffee: 4, balance: 3, foam: 3, presentation: 3, temperature: 4 },
        { vodka: 'House vodka', coffee: 'Fresh espresso', liqueur: 'Kahlúa', sweetener: 'Simple syrup', garnish: '3 coffee beans', extras: [] },
        'Good coffee, a touch too sweet, foam faded fast.', true),
      t('b1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000004', '2026-07-30', 17, { coffee: 2, balance: 2, foam: 1, presentation: 3, temperature: 3 },
        { vodka: 'Smirnoff', coffee: 'Espresso shot (bottled)', liqueur: 'Kahlúa', sweetener: 'Simple syrup', garnish: 'None', extras: [] },
        'Flat, watery, no foam. Bottled espresso.', false),
      t('b1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000005', '2026-05-18', 24, { coffee: 5, balance: 4, foam: 4, presentation: 5, temperature: 5 },
        { vodka: 'Belvedere', coffee: 'Nitro cold brew', liqueur: 'Mr Black', sweetener: 'Salted caramel', garnish: 'Chocolate shavings', extras: ['Sea salt'] },
        'Theatrical pour. Salted caramel works better than it should.', true),
    ],
  };
}
