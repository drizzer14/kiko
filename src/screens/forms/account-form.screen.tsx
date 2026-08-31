import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import Box from '../../design-system/components/box';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { AccountsStackParamList } from '../../navigation/types';
import { accountsRepo } from '../../repositories/accounts.repo';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

const kinds = ['bank', 'cash', 'crypto', 'broker'] as const;
type Kind = (typeof kinds)[number];

const AccountFormScreen: FC<AccountFormScreenProps> = ({ navigation }) => {
  const { theme } = useUnistyles();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('bank');

  const save = async (): Promise<void> => {
    await accountsRepo.create({ name, kind });
    navigation.goBack();
  };

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Add account</Text>

        <TextInput
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.border },
          ]}
        />

        <Box style={styles.chipRow} gap={2}>
          {kinds.map(option => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === option }}
              onPress={() => setKind(option)}
              style={[
                styles.chip,
                { backgroundColor: kind === option ? theme.colors.accent : theme.colors.surface },
              ]}
            >
              <Text variant="body">{option}</Text>
            </Pressable>
          ))}
        </Box>

        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={[styles.button, { backgroundColor: theme.colors.accent }]}
        >
          <Text variant="body">Save</Text>
        </Pressable>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create(theme => ({
  input: {
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
    ...theme.typography.body,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
    alignSelf: 'flex-start',
  },
}));

export default AccountFormScreen;
