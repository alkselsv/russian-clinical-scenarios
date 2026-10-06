# Российские клинические сценарии

Автономный исследовательский набор клинических случаев. Репозиторий содержит редакторские данные, справочники, правила оценки, генератор и готовые runtime-варианты. Исходные выгрузки и идентификаторы внешнего набора в него не входят.

Сейчас реализованы коллекция `emergency` из шести случаев и по десять случаев в коллекциях `cardiology`, `dermatology`, `gastroenterology`, `ent`, `internal-medicine`, `nephrology`, `neurology` и `neurosurgery`. Все случаи имеют статус `unsafe-until-clinician-approved`: структура пригодна для разработки исследовательского прототипа, но клиническое содержание ещё требует независимой врачебной приёмки.

## Структура

```text
data/
  catalogs/                         # общие справочники действий и исследований
  references/                       # зафиксированные версии КР
  cases/
    emergency/
      content.json                  # пациент, анамнез и результаты исследований
      rules.json                    # диагнозы и правила оценки
      runtime-config.json           # факты, условия и группы выбора
    cardiology/                     # те же три файла для кардиологии
    dermatology/                    # те же три файла для дерматологии
    gastroenterology/               # те же три файла для гастроэнтерологии
    ent/                            # те же три файла для оториноларингологии
    internal-medicine/              # те же три файла для внутренних болезней
    nephrology/                     # те же три файла для нефрологии
    neurology/                      # те же три файла для неврологии
    neurosurgery/                   # те же три файла для нейрохирургии
docs/
  audits/                           # клинические аудиты
  SCHEMA.md                         # контракт редакторского и runtime-слоёв
runtime/
  emergency.json                    # сгенерированный файл для приложения
  cardiology.json                   # сгенерированные амбулаторные случаи
  dermatology.json                  # сгенерированные дерматологические случаи
  gastroenterology.json             # сгенерированные гастроэнтерологические случаи
  ent.json                          # сгенерированные ЛОР-случаи
  internal-medicine.json            # сгенерированные терапевтические случаи
  nephrology.json                   # сгенерированные нефрологические случаи
  neurology.json                    # сгенерированные неврологические случаи
  neurosurgery.json                 # сгенерированные нейрохирургические случаи
scripts/
  generate-runtime.mjs              # конвертор редакторских данных в runtime
  validate.mjs                      # проверка автономности и связности
```

Приложение читает готовый файл `runtime/<collection>.json` нужной коллекции. Файлы в `data/` предназначены для редакторов, медицинских экспертов и генератора.

## Команды

Требуется Node.js 20 или новее; устанавливать зависимости не нужно.

```bash
npm run build
npm run check
npm run validate
```

- `build` пересобирает runtime;
- `check` ничего не изменяет и проверяет, что runtime актуален;
- `validate` проверяет JSON, запрещённые поля происхождения, ссылки на аудит и воспроизводимость сборки.

Эквивалентный прямой вызов конвертора:

```bash
node scripts/generate-runtime.mjs --collection emergency
node scripts/generate-runtime.mjs --collection emergency --check
node scripts/generate-runtime.mjs --collection dermatology
node scripts/generate-runtime.mjs --collection dermatology --check
node scripts/generate-runtime.mjs --collection gastroenterology
node scripts/generate-runtime.mjs --collection gastroenterology --check
node scripts/generate-runtime.mjs --collection ent
node scripts/generate-runtime.mjs --collection ent --check
node scripts/generate-runtime.mjs --collection internal-medicine
node scripts/generate-runtime.mjs --collection internal-medicine --check
node scripts/generate-runtime.mjs --collection nephrology
node scripts/generate-runtime.mjs --collection nephrology --check
node scripts/generate-runtime.mjs --collection neurology
node scripts/generate-runtime.mjs --collection neurology --check
node scripts/generate-runtime.mjs --collection neurosurgery
node scripts/generate-runtime.mjs --collection neurosurgery --check
```

## Добавление коллекции

Для новой специальности или группы случаев создайте `data/cases/<collection>/` с тремя файлами того же контракта: `content.json`, `rules.json`, `runtime-config.json`. Общие действия, исследования и рекомендации добавляются в соответствующие каталоги. Затем выполните:

```bash
node scripts/generate-runtime.mjs --collection <collection>
```

Если новая коллекция требует другого медицинского процесса, расширяйте структурированные факты и условия, а не добавляйте продуктовую логику в свободный текст.

## Работа с runtime

Каждый случай содержит открытые данные пациента и закрытую часть с правильными действиями и результатами исследований. Если защита от подсматривания важна, полный runtime должен оставаться на сервере; клиент получает только разрешённую часть выбранного случая.

Правила разделены на `required`, `conditional`, `optional`, `avoid` и `unsafe`. Для `conditional` приложение вычисляет поле `when` по текущим `facts`; `applicableNow` содержит результат только для начального состояния.

## Ограничения

- набор предназначен для исследования и разработки прототипа;
- успешная структурная проверка не является клинической валидацией;
- сведения необходимо повторно сверять при обновлении клинических рекомендаций и нормативных справочников;
- точные коды ФСЛИ пока не присвоены.

Общий порядок подготовки новых блоков приведён в [CONTRIBUTING.md](CONTRIBUTING.md), подробная схема — в [docs/SCHEMA.md](docs/SCHEMA.md), результаты медицинского анализа — в каталоге [docs/audits](docs/audits/).
