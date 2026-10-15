/*
 Rescales every stored USDT amount from scale 2 to scale 8 (x 1000000), exactly.

 USDT moves to the same eight decimals as every other crypto currency, so the integer minor
 units already stored must grow by the factor the scale grew by or every balance would read a
 million times smaller. The rescale covers a holding's balance and synced balance, every row on a
 USDT holding, and the minor-unit fields kept inside JSON: a holding's metadata (the deposit
 contributions, a loan's principal, a bond's face value and purchase price, a lot's cost), a
 category rule's amount matchers and a transaction template's amounts and returns. A JSON field
 is rescaled only when its currency is USDT and its stored value is an integer: a string, a real
 or a missing field, and every non-USDT value, stay as they are. Price points, currency rates and
 the NBU bond register carry no USDT minor units and are not touched.

 Every JSON access sits behind CASE WHEN json_valid(...), because json_type, json_extract and
 json_each raise on malformed text and one unreadable row must not stop the upgrade; such a row is
 left byte-for-byte as it was. An array is rebuilt element for element in its order, and an
 element that is not rescaled is copied through its own JSON text, so a boolean stays a boolean
 and a number keeps its digits.

 Data only, no schema change, so no snapshot JSON (same as 0049). The `.kiko` restore applies the
 identical rule to a file written before the scale change.
*/
--> statement-breakpoint
UPDATE `holdings` SET `balance_minor_units` = `balance_minor_units` * 1000000,
  `synced_balance_minor_units` = `synced_balance_minor_units` * 1000000
  WHERE `currency` = 'USDT';
--> statement-breakpoint
UPDATE `transactions` SET `amount_minor_units` = `amount_minor_units` * 1000000
  WHERE `holding_id` IN (SELECT `id` FROM `holdings` WHERE `currency` = 'USDT');
--> statement-breakpoint
UPDATE `holdings` SET `metadata` = json_set(`metadata`, '$.principalMinorUnits',
    json_extract(`metadata`, '$.principalMinorUnits') * 1000000)
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.principalMinorUnits') END = 'integer';
--> statement-breakpoint
UPDATE `holdings` SET `metadata` = json_set(`metadata`, '$.faceValueMinorUnits',
    json_extract(`metadata`, '$.faceValueMinorUnits') * 1000000)
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.faceValueMinorUnits') END = 'integer';
--> statement-breakpoint
UPDATE `holdings` SET `metadata` = json_set(`metadata`, '$.purchasePriceMinorUnits',
    json_extract(`metadata`, '$.purchasePriceMinorUnits') * 1000000)
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.purchasePriceMinorUnits') END = 'integer';
--> statement-breakpoint
UPDATE `holdings` SET `metadata` = json_set(`metadata`, '$.contributions', json((
    SELECT json_group_array(CASE
        WHEN CASE WHEN element.type = 'object'
          THEN json_type(element.value, '$.amountMinorUnits') END = 'integer'
          THEN json_set(element.value, '$.amountMinorUnits', json_extract(element.value, '$.amountMinorUnits') * 1000000)
        ELSE json(CASE WHEN json_valid(`metadata`) THEN `metadata` -> element.fullkey END)
      END ORDER BY element.key)
    FROM json_each(`metadata`, '$.contributions') AS element)))
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.contributions') END = 'array'
    AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(`metadata`) THEN `metadata` END, '$.contributions') AS element
      WHERE CASE WHEN element.type = 'object'
          THEN json_type(element.value, '$.amountMinorUnits') END = 'integer');
--> statement-breakpoint
UPDATE `holdings` SET `metadata` = json_set(`metadata`, '$.lots', json((
    SELECT json_group_array(CASE
        WHEN CASE WHEN element.type = 'object'
          THEN json_type(element.value, '$.costMinorUnits') END = 'integer'
          THEN json_set(element.value, '$.costMinorUnits', json_extract(element.value, '$.costMinorUnits') * 1000000)
        ELSE json(CASE WHEN json_valid(`metadata`) THEN `metadata` -> element.fullkey END)
      END ORDER BY element.key)
    FROM json_each(`metadata`, '$.lots') AS element)))
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.lots') END = 'array'
    AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(`metadata`) THEN `metadata` END, '$.lots') AS element
      WHERE CASE WHEN element.type = 'object'
          THEN json_type(element.value, '$.costMinorUnits') END = 'integer');
--> statement-breakpoint
UPDATE `category_rules` SET `matchers` = json_set(`matchers`, '$', json((
    SELECT json_group_array(CASE
        WHEN CASE WHEN element.type = 'object' THEN
          CASE WHEN json_extract(element.value, '$.type') = 'amount' THEN
            CASE WHEN json_extract(element.value, '$.currency') = 'USDT'
              THEN json_type(element.value, '$.minorUnits') END
          END
        END = 'integer'
          THEN json_set(element.value, '$.minorUnits', json_extract(element.value, '$.minorUnits') * 1000000)
        ELSE json(CASE WHEN json_valid(`matchers`) THEN `matchers` -> element.fullkey END)
      END ORDER BY element.key)
    FROM json_each(`matchers`, '$') AS element)))
  WHERE CASE WHEN json_valid(`matchers`) THEN json_type(`matchers`, '$') END = 'array'
    AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(`matchers`) THEN `matchers` END, '$') AS element
      WHERE CASE WHEN element.type = 'object' THEN
          CASE WHEN json_extract(element.value, '$.type') = 'amount' THEN
            CASE WHEN json_extract(element.value, '$.currency') = 'USDT'
              THEN json_type(element.value, '$.minorUnits') END
          END
        END = 'integer');
--> statement-breakpoint
UPDATE `transaction_templates` SET `draft` = json_set(`draft`, '$.amountMinorUnits',
    json_extract(`draft`, '$.amountMinorUnits') * 1000000)
  WHERE CASE WHEN json_valid(`draft`) THEN json_extract(`draft`, '$.currency') END = 'USDT'
    AND CASE WHEN json_valid(`draft`) THEN json_type(`draft`, '$.amountMinorUnits') END = 'integer';
--> statement-breakpoint
UPDATE `transaction_templates` SET `draft` = json_set(`draft`, '$.exchange.valueInMinorUnits',
    json_extract(`draft`, '$.exchange.valueInMinorUnits') * 1000000)
  WHERE CASE WHEN json_valid(`draft`) THEN json_extract(`draft`, '$.exchange.destinationCurrency') END = 'USDT'
    AND CASE WHEN json_valid(`draft`) THEN json_type(`draft`, '$.exchange.valueInMinorUnits') END = 'integer';
--> statement-breakpoint
UPDATE `transaction_templates` SET `draft` = json_set(`draft`, '$.returns', json((
    SELECT json_group_array(CASE
        WHEN CASE WHEN element.type = 'object'
          THEN json_type(element.value, '$.amountMinorUnits') END = 'integer'
          THEN json_set(element.value, '$.amountMinorUnits', json_extract(element.value, '$.amountMinorUnits') * 1000000)
        ELSE json(CASE WHEN json_valid(`draft`) THEN `draft` -> element.fullkey END)
      END ORDER BY element.key)
    FROM json_each(`draft`, '$.returns') AS element)))
  WHERE CASE WHEN json_valid(`draft`) THEN json_extract(`draft`, '$.currency') END = 'USDT'
    AND CASE WHEN json_valid(`draft`) THEN json_type(`draft`, '$.returns') END = 'array'
    AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(`draft`) THEN `draft` END, '$.returns') AS element
      WHERE CASE WHEN element.type = 'object'
          THEN json_type(element.value, '$.amountMinorUnits') END = 'integer');
