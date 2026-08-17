import 'package:flutter/material.dart';

/// Lightweight i18n (rule: no hardcoded user-visible text).
/// Locales: uz-latn (default), uz-cyrl, ru — TZ §3.1.
class AppStrings {
  AppStrings(this.localeCode);

  final String localeCode;

  static const supported = ['uz-latn', 'uz-cyrl', 'ru'];
  static const fallback = 'uz-latn';

  static AppStrings of(BuildContext context) =>
      Localizations.of<AppStrings>(context, AppStrings)!;

  String t(String key) =>
      _messages[localeCode]?[key] ?? _messages[fallback]![key] ?? key;

  static const Map<String, Map<String, String>> _messages = {
    'uz-latn': {
      'app.title': 'TruckControl AI',
      'login.title': 'Haydovchi kirishi',
      'login.phone': 'Telefon raqami',
      'login.sendCode': 'Kod olish',
      'login.codeSent': 'SMS kod yuborildi',
      'login.code': 'SMS kod',
      'login.verify': 'Kirish',
      'tab.trip': 'Reys',
      'tab.expenses': 'Xarajatlarim',
      'tab.documents': 'Hujjatlarim',
      'tab.profile': 'Profil',
      'trip.none': 'Faol reys yo\'q. Logist reys biriktirganda shu yerda ko\'rinadi.',
      'trip.number': 'Reys',
      'trip.cargo': 'Yuk',
      'trip.advance': 'Avans',
      'event.START': 'Yo\'lga chiqdim',
      'event.LOADED': 'Yuk ortildi',
      'event.REST': 'Dam / Obed',
      'event.RESUME': 'Davom ettirdim',
      'event.REFUEL': 'Yoqilg\'i quydim',
      'event.BREAKDOWN': 'Nosozlik',
      'event.CUSTOMS': 'Chegara / Bojxona',
      'event.EXPENSE': 'Yo\'l xarajati',
      'event.DELIVERED': 'Yuk topshirildi',
      'event.FINISH': 'Reys tugadi',
      'form.comment': 'Izoh',
      'form.odometer': 'Spidometr (km)',
      'form.liters': 'Litr',
      'form.amount': 'Summa (so\'m)',
      'form.photo': 'Foto',
      'form.takePhoto': 'Suratga olish',
      'form.photoTaken': 'Foto olindi',
      'form.save': 'Saqlash',
      'form.savedOffline': 'Saqlandi. Internet kelganda yuboriladi.',
      'form.saved': 'Saqlandi va yuborildi.',
      'sync.pending': 'Yuborilmagan yozuvlar',
      'sync.syncNow': 'Hozir yuborish',
      'sync.done': 'Hammasi yuborildi',
      'sync.failed': 'Yuborilmagan hodisalar',
      'sync.failedHint': 'Server qabul qilmadi. Logist bilan bog\'laning yoki qayta yuboring.',
      'sync.retry': 'Qayta yuborish',
      'expenses.empty': 'Hozircha yozuvlar yo\'q',
      'documents.note': 'Hujjatlar bo\'limi keyingi bosqichda ulanadi.',
      'profile.language': 'Til',
      'profile.logout': 'Chiqish',
      'gps.notification.title': 'TruckControl — reys kuzatuvi',
      'gps.notification.text': 'GPS yozilmoqda',
      'common.loading': 'Yuklanmoqda…',
      'common.error': 'Xatolik. Qayta urinib ko\'ring',
      'common.retry': 'Qayta urinish',
      'common.cancel': 'Bekor qilish',
    },
    'uz-cyrl': {
      'app.title': 'TruckControl AI',
      'login.title': 'Ҳайдовчи кириши',
      'login.phone': 'Телефон рақами',
      'login.sendCode': 'Код олиш',
      'login.codeSent': 'SMS код юборилди',
      'login.code': 'SMS код',
      'login.verify': 'Кириш',
      'tab.trip': 'Рейс',
      'tab.expenses': 'Харажатларим',
      'tab.documents': 'Ҳужжатларим',
      'tab.profile': 'Профиль',
      'trip.none': 'Фаол рейс йўқ. Логист рейс бириктирганда шу ерда кўринади.',
      'trip.number': 'Рейс',
      'trip.cargo': 'Юк',
      'trip.advance': 'Аванс',
      'event.START': 'Йўлга чиқдим',
      'event.LOADED': 'Юк ортилди',
      'event.REST': 'Дам / Обед',
      'event.RESUME': 'Давом эттирдим',
      'event.REFUEL': 'Ёқилғи қуйдим',
      'event.BREAKDOWN': 'Носозлик',
      'event.CUSTOMS': 'Чегара / Божхона',
      'event.EXPENSE': 'Йўл харажати',
      'event.DELIVERED': 'Юк топширилди',
      'event.FINISH': 'Рейс тугади',
      'form.comment': 'Изоҳ',
      'form.odometer': 'Спидометр (км)',
      'form.liters': 'Литр',
      'form.amount': 'Сумма (сўм)',
      'form.photo': 'Фото',
      'form.takePhoto': 'Суратга олиш',
      'form.photoTaken': 'Фото олинди',
      'form.save': 'Сақлаш',
      'form.savedOffline': 'Сақланди. Интернет келганда юборилади.',
      'form.saved': 'Сақланди ва юборилди.',
      'sync.pending': 'Юборилмаган ёзувлар',
      'sync.syncNow': 'Ҳозир юбориш',
      'sync.done': 'Ҳаммаси юборилди',
      'sync.failed': 'Юборилмаган ҳодисалар',
      'sync.failedHint': 'Сервер қабул қилмади. Логист билан боғланинг ёки қайта юборинг.',
      'sync.retry': 'Қайта юбориш',
      'expenses.empty': 'Ҳозирча ёзувлар йўқ',
      'documents.note': 'Ҳужжатлар бўлими кейинги босқичда уланади.',
      'profile.language': 'Тил',
      'profile.logout': 'Чиқиш',
      'gps.notification.title': 'TruckControl — рейс кузатуви',
      'gps.notification.text': 'GPS ёзилмоқда',
      'common.loading': 'Юкланмоқда…',
      'common.error': 'Хатолик. Қайта уриниб кўринг',
      'common.retry': 'Қайта уриниш',
      'common.cancel': 'Бекор қилиш',
    },
    'ru': {
      'app.title': 'TruckControl AI',
      'login.title': 'Вход для водителя',
      'login.phone': 'Номер телефона',
      'login.sendCode': 'Получить код',
      'login.codeSent': 'SMS-код отправлен',
      'login.code': 'SMS-код',
      'login.verify': 'Войти',
      'tab.trip': 'Рейс',
      'tab.expenses': 'Мои расходы',
      'tab.documents': 'Мои документы',
      'tab.profile': 'Профиль',
      'trip.none': 'Нет активного рейса. Он появится здесь, когда логист назначит рейс.',
      'trip.number': 'Рейс',
      'trip.cargo': 'Груз',
      'trip.advance': 'Аванс',
      'event.START': 'Выехал',
      'event.LOADED': 'Груз загружен',
      'event.REST': 'Отдых / Обед',
      'event.RESUME': 'Продолжил путь',
      'event.REFUEL': 'Заправился',
      'event.BREAKDOWN': 'Поломка',
      'event.CUSTOMS': 'Граница / Таможня',
      'event.EXPENSE': 'Дорожный расход',
      'event.DELIVERED': 'Груз сдан',
      'event.FINISH': 'Рейс завершён',
      'form.comment': 'Комментарий',
      'form.odometer': 'Одометр (км)',
      'form.liters': 'Литры',
      'form.amount': 'Сумма (сум)',
      'form.photo': 'Фото',
      'form.takePhoto': 'Сделать фото',
      'form.photoTaken': 'Фото сделано',
      'form.save': 'Сохранить',
      'form.savedOffline': 'Сохранено. Отправится при появлении интернета.',
      'form.saved': 'Сохранено и отправлено.',
      'sync.pending': 'Неотправленные записи',
      'sync.syncNow': 'Отправить сейчас',
      'sync.done': 'Всё отправлено',
      'sync.failed': 'Неотправленные события',
      'sync.failedHint': 'Сервер отклонил их. Свяжитесь с логистом или отправьте снова.',
      'sync.retry': 'Отправить снова',
      'expenses.empty': 'Записей пока нет',
      'documents.note': 'Раздел документов подключается на следующем этапе.',
      'profile.language': 'Язык',
      'profile.logout': 'Выйти',
      'gps.notification.title': 'TruckControl — отслеживание рейса',
      'gps.notification.text': 'Записывается GPS',
      'common.loading': 'Загрузка…',
      'common.error': 'Ошибка. Повторите попытку',
      'common.retry': 'Повторить',
      'common.cancel': 'Отмена',
    },
  };

  /// Test hook: every locale must translate every key.
  @visibleForTesting
  static Map<String, Map<String, String>> get messages => _messages;
}

class AppStringsDelegate extends LocalizationsDelegate<AppStrings> {
  const AppStringsDelegate(this.localeCode);

  final String localeCode;

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<AppStrings> load(Locale locale) async => AppStrings(localeCode);

  @override
  bool shouldReload(AppStringsDelegate old) => old.localeCode != localeCode;
}
