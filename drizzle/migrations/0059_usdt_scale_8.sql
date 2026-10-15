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

 A statement-import key (<holding id> <time> <amount> <description>) carries the amount of the
 row it stands for, so the amount token of every key whose first token names a USDT holding is
 rescaled too, in transactions and in deleted_import_keys; otherwise a re-import at the new scale
 would not find the stored key and would add the row again. A key of any other shape, or with an
 amount token that is not a plain integer, is left alone. The keys are rewritten in two phases
 (a unique temporary key, then the final key) because the UNIQUE (source, external_id) check
 fires per row and a new key can equal another row's old key.

 A stored USDT value above 9007199254 in either direction would rescale past the largest exact
 JavaScript integer (9007199254 becomes 9007199254000000), so the upgrade first counts every value
 it would rescale that is out of that bound and, when the count is not zero, aborts on the CHECK of
 a temp guard table before anything is written. The count uses exactly the predicate of the
 statement it guards, so a value the rescale leaves (a UAH value, a string, a real, malformed
 JSON) never aborts it.

 Data only, no schema change, so no snapshot JSON (same as 0049). The `.kiko` restore applies the
 identical rule to a file written before the scale change.
*/
DROP TABLE IF EXISTS `usdt_rescale_bound`;
--> statement-breakpoint
CREATE TEMP TABLE `usdt_rescale_bound`
  (`over_bound` integer CONSTRAINT usdt_rescale_guard CHECK (`over_bound` = 0));
--> statement-breakpoint
DROP TABLE IF EXISTS `usdt_import_keys`;
--> statement-breakpoint
CREATE TEMP TABLE `usdt_import_keys` (`table_name` text NOT NULL, `row_key` text NOT NULL,
  `old_key` text NOT NULL, `amount_token` text NOT NULL, `new_key` text);
--> statement-breakpoint
INSERT INTO `usdt_import_keys`
  (`table_name`, `row_key`, `old_key`, `amount_token`, `new_key`)
SELECT 'transactions', row_key, old_key, amount_token,
  CASE WHEN CAST(amount_token AS INTEGER) || '' = amount_token
    THEN prefix || (CAST(amount_token AS INTEGER) * 1000000) || suffix END
FROM (SELECT row_key, old_key, holding_token, amount_token,
      substr(old_key, 1, length(old_key) - length(after_time)) AS prefix,
      substr(after_time, instr(after_time, ' ')) AS suffix
    FROM (SELECT row_key, old_key, holding_token, after_time,
        substr(after_time, 1, instr(after_time, ' ') - 1) AS amount_token
      FROM (SELECT row_key, old_key, holding_token,
          substr(after_holding, instr(after_holding, ' ') + 1) AS after_time
        FROM (SELECT row_key, old_key,
            substr(old_key, 1, instr(old_key, ' ') - 1) AS holding_token,
            substr(old_key, instr(old_key, ' ') + 1) AS after_holding
          FROM (SELECT `id` AS row_key, `external_id` AS old_key FROM `transactions` WHERE `source` = 'import' AND `external_id` IS NOT NULL)))))
WHERE holding_token IN (SELECT `id` FROM `holdings` WHERE `currency` = 'USDT');
--> statement-breakpoint
INSERT INTO `usdt_import_keys`
  (`table_name`, `row_key`, `old_key`, `amount_token`, `new_key`)
SELECT 'deleted_import_keys', row_key, old_key, amount_token,
  CASE WHEN CAST(amount_token AS INTEGER) || '' = amount_token
    THEN prefix || (CAST(amount_token AS INTEGER) * 1000000) || suffix END
FROM (SELECT row_key, old_key, holding_token, amount_token,
      substr(old_key, 1, length(old_key) - length(after_time)) AS prefix,
      substr(after_time, instr(after_time, ' ')) AS suffix
    FROM (SELECT row_key, old_key, holding_token, after_time,
        substr(after_time, 1, instr(after_time, ' ') - 1) AS amount_token
      FROM (SELECT row_key, old_key, holding_token,
          substr(after_holding, instr(after_holding, ' ') + 1) AS after_time
        FROM (SELECT row_key, old_key,
            substr(old_key, 1, instr(old_key, ' ') - 1) AS holding_token,
            substr(old_key, instr(old_key, ' ') + 1) AS after_holding
          FROM (SELECT CAST(`rowid` AS text) AS row_key, `external_id` AS old_key FROM `deleted_import_keys`)))))
WHERE holding_token IN (SELECT `id` FROM `holdings` WHERE `currency` = 'USDT');
--> statement-breakpoint
INSERT INTO `usdt_rescale_bound` (`over_bound`) SELECT
  (SELECT count(*) FROM `holdings`
  WHERE CASE WHEN `currency` = 'USDT' THEN
    `balance_minor_units` < -9007199254 OR `balance_minor_units` > 9007199254
    OR `synced_balance_minor_units` < -9007199254 OR `synced_balance_minor_units` > 9007199254 END)
  + (SELECT count(*) FROM `transactions`
  WHERE CASE WHEN `holding_id` IN (SELECT `id` FROM `holdings` WHERE `currency` = 'USDT') THEN
    `amount_minor_units` < -9007199254 OR `amount_minor_units` > 9007199254 END)
  + (SELECT count(*) FROM `holdings`
  WHERE CASE WHEN `currency` = 'USDT' AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.principalMinorUnits') END = 'integer' THEN
    json_extract(`metadata`, '$.principalMinorUnits') < -9007199254 OR json_extract(`metadata`, '$.principalMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `holdings`
  WHERE CASE WHEN `currency` = 'USDT' AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.faceValueMinorUnits') END = 'integer' THEN
    json_extract(`metadata`, '$.faceValueMinorUnits') < -9007199254 OR json_extract(`metadata`, '$.faceValueMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `holdings`
  WHERE CASE WHEN `currency` = 'USDT' AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.purchasePriceMinorUnits') END = 'integer' THEN
    json_extract(`metadata`, '$.purchasePriceMinorUnits') < -9007199254 OR json_extract(`metadata`, '$.purchasePriceMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `holdings`,
    json_each(CASE WHEN json_valid(`holdings`.`metadata`) THEN `holdings`.`metadata` END, '$.contributions') AS element
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.contributions') END = 'array'
    AND CASE WHEN CASE WHEN element.type = 'object'
        THEN json_type(element.value, '$.amountMinorUnits') END = 'integer' THEN json_extract(element.value, '$.amountMinorUnits') < -9007199254 OR json_extract(element.value, '$.amountMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `holdings`,
    json_each(CASE WHEN json_valid(`holdings`.`metadata`) THEN `holdings`.`metadata` END, '$.lots') AS element
  WHERE `currency` = 'USDT'
    AND CASE WHEN json_valid(`metadata`) THEN json_type(`metadata`, '$.lots') END = 'array'
    AND CASE WHEN CASE WHEN element.type = 'object'
        THEN json_type(element.value, '$.costMinorUnits') END = 'integer' THEN json_extract(element.value, '$.costMinorUnits') < -9007199254 OR json_extract(element.value, '$.costMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `category_rules`,
    json_each(CASE WHEN json_valid(`category_rules`.`matchers`) THEN `category_rules`.`matchers` END, '$') AS element
  WHERE CASE WHEN json_valid(`matchers`) THEN json_type(`matchers`, '$') END = 'array'
    AND CASE WHEN CASE WHEN element.type = 'object' THEN
        CASE WHEN json_extract(element.value, '$.type') = 'amount' THEN
          CASE WHEN json_extract(element.value, '$.currency') = 'USDT'
            THEN json_type(element.value, '$.minorUnits') END
        END
      END = 'integer' THEN json_extract(element.value, '$.minorUnits') < -9007199254 OR json_extract(element.value, '$.minorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `transaction_templates`
  WHERE CASE WHEN CASE WHEN json_valid(`draft`) THEN json_extract(`draft`, '$.currency') END = 'USDT' AND CASE WHEN json_valid(`draft`) THEN json_type(`draft`, '$.amountMinorUnits') END = 'integer' THEN
    json_extract(`draft`, '$.amountMinorUnits') < -9007199254 OR json_extract(`draft`, '$.amountMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `transaction_templates`
  WHERE CASE WHEN CASE WHEN json_valid(`draft`) THEN json_extract(`draft`, '$.exchange.destinationCurrency') END = 'USDT' AND CASE WHEN json_valid(`draft`) THEN json_type(`draft`, '$.exchange.valueInMinorUnits') END = 'integer' THEN
    json_extract(`draft`, '$.exchange.valueInMinorUnits') < -9007199254 OR json_extract(`draft`, '$.exchange.valueInMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `transaction_templates`,
    json_each(CASE WHEN json_valid(`transaction_templates`.`draft`) THEN `transaction_templates`.`draft` END, '$.returns') AS element
  WHERE CASE WHEN json_valid(`draft`) THEN json_extract(`draft`, '$.currency') END = 'USDT'
    AND CASE WHEN json_valid(`draft`) THEN json_type(`draft`, '$.returns') END = 'array'
    AND CASE WHEN CASE WHEN element.type = 'object'
        THEN json_type(element.value, '$.amountMinorUnits') END = 'integer' THEN json_extract(element.value, '$.amountMinorUnits') < -9007199254 OR json_extract(element.value, '$.amountMinorUnits') > 9007199254 END)
  + (SELECT count(*) FROM `usdt_import_keys`
  WHERE CASE WHEN CAST(`amount_token` AS INTEGER) || '' = `amount_token` THEN
    CAST(`amount_token` AS INTEGER) < -9007199254 OR CAST(`amount_token` AS INTEGER) > 9007199254 END);
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
--> statement-breakpoint
UPDATE `transactions` SET `external_id` = 'usdt-rescale␟' || `id`
  WHERE `id` IN (SELECT `row_key` FROM `usdt_import_keys`
    WHERE `table_name` = 'transactions' AND `new_key` IS NOT NULL);
--> statement-breakpoint
UPDATE `deleted_import_keys` SET `external_id` = 'usdt-rescale␟' || `rowid`
  WHERE `rowid` IN (SELECT CAST(`row_key` AS INTEGER) FROM `usdt_import_keys`
    WHERE `table_name` = 'deleted_import_keys' AND `new_key` IS NOT NULL);
--> statement-breakpoint
UPDATE `transactions` SET `external_id` = (SELECT `new_key` FROM `usdt_import_keys` AS listed
    WHERE listed.`table_name` = 'transactions' AND listed.`row_key` = `transactions`.`id`)
  WHERE `id` IN (SELECT `row_key` FROM `usdt_import_keys`
    WHERE `table_name` = 'transactions' AND `new_key` IS NOT NULL);
--> statement-breakpoint
UPDATE `deleted_import_keys` SET `external_id` = (SELECT `new_key` FROM `usdt_import_keys` AS listed
    WHERE listed.`table_name` = 'deleted_import_keys'
      AND CAST(listed.`row_key` AS INTEGER) = `deleted_import_keys`.`rowid`)
  WHERE `rowid` IN (SELECT CAST(`row_key` AS INTEGER) FROM `usdt_import_keys`
    WHERE `table_name` = 'deleted_import_keys' AND `new_key` IS NOT NULL);
--> statement-breakpoint
DROP TABLE `usdt_import_keys`;
--> statement-breakpoint
DROP TABLE `usdt_rescale_bound`;
