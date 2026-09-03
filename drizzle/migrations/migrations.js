// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_aromatic_carmella_unuscione.sql';
import m0001 from './0001_mushy_obadiah_stane.sql';
import m0002 from './0002_seed_categories.sql';
import m0003 from './0003_special_the_phantom.sql';
import m0004 from './0004_abnormal_energizer.sql';
import m0005 from './0005_add_entity_color.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
  },
};
