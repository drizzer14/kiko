> 🇬🇧 [Читати англійською (English)](./README.en.md)

Це новий проєкт на [**React Native**](https://reactnative.dev), створений за допомогою [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Початок роботи

> **Примітка**: перш ніж продовжувати, переконайтеся, що ви пройшли посібник [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment).

## Крок 1: запустіть Metro

Спершу потрібно запустити **Metro** — інструмент збірки JavaScript для React Native.

Щоб запустити dev-сервер Metro, виконайте таку команду з кореня вашого проєкту React Native:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Крок 2: зберіть і запустіть застосунок

Поки Metro працює, відкрийте нове вікно/панель терміналу з кореня вашого проєкту React Native та скористайтеся однією з наведених нижче команд, щоб зібрати й запустити застосунок для Android або iOS:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

Для iOS не забудьте встановити залежності CocoaPods (це потрібно робити лише під час першого клонування або після оновлення нативних залежностей).

Коли ви створюєте новий проєкт уперше, запустіть Ruby bundler, щоб встановити сам CocoaPods:

```sh
bundle install
```

Далі — і щоразу після оновлення нативних залежностей — виконайте:

```sh
bundle exec pod install
```

Докладніше читайте в посібнику [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

Якщо все налаштовано правильно, ви побачите свій новий застосунок, що працює в емуляторі Android, симуляторі iOS або на під'єднаному пристрої.

Це один зі способів запустити застосунок — ви також можете зібрати його безпосередньо в Android Studio або Xcode.

## Крок 3: змініть застосунок

Тепер, коли ви успішно запустили застосунок, час внести зміни!

Відкрийте `App.tsx` у вашому улюбленому текстовому редакторі та внесіть якісь зміни. Коли ви збережете файл, застосунок автоматично оновиться й відобразить ці зміни — це працює завдяки [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

Коли потрібно примусово перезавантажити застосунок, наприклад щоб скинути його стан, ви можете виконати повне перезавантаження:

- **Android**: двічі натисніть клавішу <kbd>R</kbd> або оберіть **«Reload»** у **Dev Menu**, яке відкривається через <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) чи <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: натисніть <kbd>R</kbd> у симуляторі iOS.

## Вітаємо! :tada:

Ви успішно запустили та змінили свій застосунок на React Native. :partying_face:

### Що далі?

- Якщо ви хочете додати цей новий код React Native до наявного застосунку, перегляньте [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- Якщо вам цікаво дізнатися більше про React Native, перегляньте [документацію](https://reactnative.dev/docs/getting-started).

# Усунення несправностей

Якщо у вас виникають труднощі з виконанням наведених вище кроків, перегляньте сторінку [Troubleshooting](https://reactnative.dev/docs/troubleshooting).

# Дізнатися більше

Щоб дізнатися більше про React Native, перегляньте такі ресурси:

- [React Native Website](https://reactnative.dev) — дізнайтеся більше про React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) — **огляд** React Native і того, як налаштувати ваше середовище.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) — **оглядова екскурсія** **основами** React Native.
- [Blog](https://reactnative.dev/blog) — читайте останні офіційні дописи **блогу** React Native.
- [`@facebook/react-native`](https://github.com/facebook/react-native) — відкритий вихідний код; **репозиторій** React Native на GitHub.
