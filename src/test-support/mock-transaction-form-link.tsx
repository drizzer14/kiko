// Importing this file replaces the transaction form with a stand-in for a navigator test of a
// link into the form. A synced row opens read-only and a manual row editable, a rule the real form
// decides from the row's source; the stand-in takes it from the id (`manual-` ids are manual) and
// its save goes back, as the real form does after its write. It lives here, not in the test, since
// a screens test may not name another screen's module.
jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { Pressable, Text } = require('react-native');

  const TransactionFormStub = ({
    navigation,
    route,
  }: {
    navigation: { goBack: () => void };
    route: { params?: { transactionId?: string } };
  }) => {
    const transactionId = route.params?.transactionId;

    return (
      <>
        <Text testID="form-transaction-id">{transactionId ?? 'none'}</Text>

        {transactionId?.startsWith('manual-') ? (
          <Pressable testID="form-save" onPress={() => navigation.goBack()}>
            <Text>Save</Text>
          </Pressable>
        ) : (
          <Text testID="form-read-only">Read only</Text>
        )}
      </>
    );
  };

  return { __esModule: true, default: TransactionFormStub };
});
