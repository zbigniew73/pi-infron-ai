# pi-infron-ai

[Polski](#polski) · [English](#english)

---

## Polski

Rozszerzenie do [Pi](https://pi.dev), które dodaje [Infron AI](https://infron.ai)
jako dostawcę modeli. Dzięki niemu w `/model` pojawia się kilkaset modeli
dostępnych przez jedno konto Infron, a rozmowa idzie przez zgodne z OpenAI
Chat Completions API.

### Szybki start

```bash
pi install git:github.com/zbigniew73/pi-infron-ai
```

1. Uruchom Pi i wpisz `/login`, wybierz **Infron AI**, wklej klucz z
   [panelu kluczy](https://infron.ai/dashboard/apiKeys).
2. Wpisz `/model` i wybierz model z prefiksem `infron/`.
3. Gdy coś nie działa, wpisz `/infron`.

### Wymagania

- Node.js 22.19.0 lub nowszy
- Pi 0.80.7 lub nowszy
- `git` w systemie (instalacja pobiera repozytorium)
- Klucz API Infron (lista modeli działa bez klucza, rozmowa już nie)

### Instalacja

```bash
pi install git:github.com/zbigniew73/pi-infron-ai       # dla bieżącego użytkownika
pi install -l git:github.com/zbigniew73/pi-infron-ai    # tylko dla bieżącego projektu
pi install https://github.com/zbigniew73/pi-infron-ai   # ten sam pakiet, pełny adres URL
```

Lista zainstalowanych: `pi list`. Aktualizacja: `pi update`. Usunięcie:
`pi remove git:github.com/zbigniew73/pi-infron-ai`.

### Co dostajesz

| Obszar | Działanie |
| --- | --- |
| Logowanie | `/login` sprawdza klucz zapytaniem o saldo, więc nie zużywa tokenów |
| Lista modeli | Pobierana na żywo z publicznego katalogu i sprawdzana pod kątem poprawności |
| Tryb offline | Wbudowany katalog zapasowy z pełną listą modeli |
| Limity | Okno kontekstu i limit odpowiedzi ustawiane z danych katalogu |
| Koszty | Ceny wejścia, wyjścia i odczytu z cache w USD |
| Reasoning | Poziomy myślenia w `/thinking` dla modeli tekstowych |
| Narzędzia | Wywoływanie funkcji i odpowiedzi strukturalne |
| Błędy | Czytelne komunikaty zamiast surowego JSON-a |
| Diagnostyka | `/infron` pokazuje źródło klucza, saldo i wynik próbnego zapytania |

### Klucz API i komenda `/infron`

Zamiast `/login` można użyć zmiennej środowiskowej:

```bash
export INFRON_API_KEY=twoj-klucz
```

PowerShell: `$env:INFRON_API_KEY = "twoj-klucz"`.

Komenda `/infron` wypisuje, skąd pochodzi klucz, saldo konta w USD oraz wynik
jednotokenowego zapytania do bieżącego lub pierwszego modelu Infron. Model
można podać ręcznie:

```text
/infron deepseek/deepseek-v4-flash
```

| Zmienna | Znaczenie |
| --- | --- |
| `INFRON_API_KEY` | Klucz API |
| `INFRON_BASE_URL` | Inny adres API (domyślnie `https://llm.onerouter.pro/v1`) |
| `PI_OFFLINE=1` | Pomija pobieranie katalogu i używa zapasowego |

Walidacja klucza: odpowiedź 200 z poprawnym ciałem oznacza sukces, HTTP 401 to
klucz odrzucony, a limity czasu, błędy serwera i nietypowe odpowiedzi są
traktowane jako chwilowa niemożność sprawdzenia.

### Modele

Przy starcie rozszerzenie pobiera publiczny katalog `GET /models`. Klucz nie
jest do tego potrzebny, ale jest dołączany, jeśli jest ustawiony. Odpowiedź
traktujemy jak dane niezaufane: sprawdzamy identyfikatory, zakresy liczb,
ceny i flagi, a duplikaty odrzucamy. Rejestrowane są modele, które:

- należą do kategorii `LLM`,
- mają punkt końcowy zgodny z OpenAI,
- zwracają tekst i obsługują streaming,
- nie są wycofane ani wyłącznie pokazowe.

Zostają wszystkie warianty, także darmowe (`:free`), z ceną zero i bez
wywoływania funkcji. Model bez obsługi narzędzi zadziała w zwykłej rozmowie,
ale w trybie agenta dostawca zwróci błąd.

Jeśli pobranie się nie uda, przekroczy 5 sekund, zwróci niepoprawny schemat
albo nie zostawi żadnego modelu, użyty zostanie katalog zapasowy. Zawiera on
pełną listę modeli z dnia odświeżenia. Odświeżenie:

```bash
npm run catalog:refresh
```

Przed zapisaniem zmian przejrzyj różnice, bo ceny i parametry modeli się
zmieniają.

**Modele darmowe.** Warianty z `:free` kosztują 0 USD, ale Infron udostępnia je
tylko kontom z saldem co najmniej 5 USD. `/infron` przypomina o tym przy
próbie użycia takiego modelu.

### Limity i koszty

- **Kontekst:** najmniejsza wartość zgłoszona przez model lub któregokolwiek
  z jego dostawców, bo zapytanie może trafić do dostawcy z niższym limitem.
- **Odpowiedź:** najmniejsza z trzech: limit z katalogu, okno kontekstu oraz
  65 536 tokenów. Gdy dane brakują, przyjmowane jest 128 000 tokenów kontekstu
  i 4 096 tokenów odpowiedzi.
- **Cena:** najniższa cena wejścia i wyjścia z katalogu, w USD za milion tokenów.
- **Cache:** jest niejawny. Rozszerzenie nie wysyła parametrów `cache_control`,
  zapis do cache nie jest rozliczany, a odczyt szacujemy na 20% ceny wejścia.

Rzeczywisty koszt zależy od dostawcy, do którego Infron skieruje zapytanie.

### Reasoning i narzędzia

Katalog nie zawiera flagi reasoning, więc rozszerzenie traktuje każdy model
tekstowy jako zdolny do rozumowania. Wyjątkiem jest krótka lista wyraźnie
nierozumujących modeli specjalistycznych (np. OCR i tłumaczenie) oraz wariantów
oznaczonych jako bez myślenia. Dla pozostałych modeli Pi wysyła
`reasoning: { "effort": ... }`. Pole wysłane do modelu, który nie rozumuje,
jest ignorowane. Poziom wybrany w `/thinking` (`minimal`, `low`, `medium`,
`high`, `xhigh`) trafia do Infron bez zmian, a `off` wysyła `none`. Poziomy są wskazówką
dla modelu i nie zmieniają zużycia tokenów w przewidywalny sposób. Wartość
`none` nie u każdego dostawcy wyłącza rozumowanie; zależy to od modelu i
dostawcy.

Tekst rozumowania z pól `reasoning_content` i `reasoning` wyświetla Pi.
Zapytania używają `max_tokens` (Infron przycina wartość do limitu modelu)
oraz roli `system`. Ścisłe schematy narzędzi są włączane tylko dla modeli
zgłaszających tryb JSON.

### Gdy coś nie działa

| Status | Znaczenie | Co zrobić |
| --- | --- | --- |
| 400 | Zapytanie odrzucone | Sprawdź treść lub zmniejsz kontekst |
| 401 | Brak lub zły klucz | Wykonaj `/login` albo sprawdź `INFRON_API_KEY` |
| 402 | Brak środków | Doładuj konto |
| 403 | Moderacja | Zmień treść lub wybierz inny model |
| 408, 429 | Limit czasu lub liczby zapytań | Spróbuj ponownie za chwilę |
| 502, 503 | Model lub dostawca niedostępny | Ponów albo wybierz inny model przez `/model` |

Komunikat zachowuje oryginalną treść błędu oraz identyfikator zapytania.
Błędy przepełnienia kontekstu są normalizowane, dzięki czemu Pi może
skompaktować rozmowę i spróbować ponownie.

Kroki diagnostyczne: `/infron`, ponowne `/login` po odrzuceniu klucza,
doładowanie konta przy pustym saldzie lub modelu `:free`, wybór innego modelu.

### Prywatność i bezpieczeństwo

- Pakiety Pi wykonują kod z uprawnieniami użytkownika, więc przejrzyj źródła
  przed instalacją.
- Po wybraniu modelu Infron treść rozmowy, wywołania narzędzi i obsługiwane
  obrazy trafiają do Infron i do dostawcy, który obsługuje dany model.
- Klucz jest przechowywany przez mechanizm poświadczeń Pi po `/login` albo
  czytany ze zmiennej `INFRON_API_KEY`. Rozszerzenie nie zapisuje w logach
  kluczy ani nazwy konta zwracanej przez punkt salda i nie zawiera telemetrii.

### Rozwój i testy

```bash
npm ci
npm run verify
```

`verify` uruchamia kontrolę typów, testy jednostkowe z atrapami sieci, audyt
zawartości paczki (w tym wyszukiwanie sekretów), instalację wygenerowanej
paczki w czystym środowisku oraz wylistowanie modeli przez prawdziwe Pi CLI.
CI robi to samo na Node.js 22.19.0 i 24.x.

```bash
npm test                 # testy jednostkowe
npm run test:watch       # testy w trybie obserwacji
npm run test:live        # opcjonalne testy na żywym API
npm run pack:check       # zawartość paczki i skan sekretów
npm run smoke:pack       # instalacja paczki i test z prawdziwym Pi CLI
```

Testy na żywo zawsze sprawdzają publiczny katalog. Z `INFRON_API_KEY`
sprawdzają też klucz, a próbne zapytanie, narzędzia i reasoning tylko wtedy,
gdy modele podano jawnie:

```bash
INFRON_API_KEY=twoj-klucz \
INFRON_TEST_MODEL=dostawca/model-czatu \
INFRON_TOOL_TEST_MODEL=dostawca/model-z-narzedziami \
INFRON_REASONING_TEST_MODEL=dostawca/model-rozumujacy \
npm run test:live
```

### Ograniczenia

- Używany jest wyłącznie punkt Chat Completions. Modele tylko dla Responses API
  oraz embeddingi, obraz, wideo i audio nie są rejestrowane.
- Routing dostawców, warstwy usług i własne klucze dostawców nie są dostępne.
- Wszystkie modele tekstowe poza krótką listą wyjątków mają włączone poziomy
  myślenia, także te, które nie rozumują. Takie modele ignorują to ustawienie.
- Faktyczny kontekst zapytania może być niższy od zarejestrowanego, jeśli
  dostawca zmieni swoje limity.

---

## English

A [Pi](https://pi.dev) extension that adds [Infron AI](https://infron.ai) as a
model provider. Several hundred models available through a single Infron
account show up in `/model`, and conversations go through the
OpenAI-compatible Chat Completions API.

### Quick start

```bash
pi install git:github.com/zbigniew73/pi-infron-ai
```

1. Start Pi, run `/login`, choose **Infron AI**, and paste a key from the
   [key dashboard](https://infron.ai/dashboard/apiKeys).
2. Run `/model` and pick a model with the `infron/` prefix.
3. If something misbehaves, run `/infron`.

### Requirements

- Node.js 22.19.0 or newer
- Pi 0.80.7 or newer
- `git` on the system (the install fetches the repository)
- An Infron API key (the model list works without one, chatting does not)

### Installation

```bash
pi install git:github.com/zbigniew73/pi-infron-ai       # for the current user
pi install -l git:github.com/zbigniew73/pi-infron-ai    # for the current project only
pi install https://github.com/zbigniew73/pi-infron-ai   # same package, full URL
```

List installed packages with `pi list`, update with `pi update`, and remove with
`pi remove git:github.com/zbigniew73/pi-infron-ai`.

### What you get

| Area | Behavior |
| --- | --- |
| Login | `/login` checks the key with a balance request, so no tokens are spent |
| Model list | Fetched live from the public catalog and validated |
| Offline mode | Bundled fallback catalog with the full model list |
| Limits | Context window and output limit set from catalog data |
| Costs | Input, output, and cache-read prices in USD |
| Reasoning | Thinking levels in `/thinking` for text models |
| Tools | Function calling and structured output |
| Errors | Readable messages instead of raw JSON |
| Diagnostics | `/infron` shows the key source, balance, and a probe result |

### API key and the `/infron` command

Instead of `/login` you can use an environment variable:

```bash
export INFRON_API_KEY=your-key
```

PowerShell: `$env:INFRON_API_KEY = "your-key"`.

`/infron` prints where the key comes from, the account balance in USD, and the
result of a one-token request to the current or first Infron model. You can
name a model explicitly:

```text
/infron deepseek/deepseek-v4-flash
```

| Variable | Meaning |
| --- | --- |
| `INFRON_API_KEY` | API key |
| `INFRON_BASE_URL` | Alternative API address (default `https://llm.onerouter.pro/v1`) |
| `PI_OFFLINE=1` | Skips catalog discovery and uses the bundled one |

Key validation: a 200 response with a well-formed body means success, HTTP 401
means the key was rejected, and timeouts, server errors, or unexpected
responses count as a temporary inability to check.

### Models

At startup the extension fetches the public `GET /models` catalog. No key is
required, but one is attached when set. The response is treated as untrusted
data: identifiers, numeric ranges, prices, and flags are checked, and
duplicates are dropped. A model is registered when it:

- is in the `LLM` category,
- has an OpenAI-compatible endpoint,
- returns text and supports streaming,
- is neither deprecated nor display-only.

All variants stay, including free (`:free`), zero-priced, and models without
function calling. A model without tool support works in plain chat, but in
agent mode the provider will return an error.

If the fetch fails, exceeds 5 seconds, returns an invalid schema, or leaves no
usable model, the bundled catalog is used instead. It holds the full model list
as of its refresh date. To refresh it:

```bash
npm run catalog:refresh
```

Review the diff before saving, because model prices and parameters change.

**Free models.** `:free` variants cost $0, but Infron serves them only to
accounts with a balance of at least $5. `/infron` reminds you of this when you
probe such a model.

### Limits and costs

- **Context:** the smallest value reported by the model or any of its
  providers, since a request may land on the provider with the lower limit.
- **Output:** the smallest of the catalog limit, the context window, and
  65,536 tokens. When data is missing, 128,000 tokens of context and 4,096
  tokens of output are assumed.
- **Price:** the lowest input and output price in the catalog, in USD per
  million tokens.
- **Cache:** implicit. The extension sends no `cache_control` parameters, cache
  writes are not billed, and reads are estimated at 20% of the input price.

The real cost depends on the provider Infron routes the request to.

### Reasoning and tools

The catalog has no reasoning flag, so the extension treats every text model as
reasoning-capable. The exception is a short list of clearly non-reasoning
specialist models (such as OCR and translation) and variants marked as
non-thinking. For all other models Pi sends `reasoning: { "effort": ... }`.
The field is ignored by models that do not reason. The level chosen in
`/thinking` (`minimal`, `low`, `medium`, `high`, `xhigh`) passes through to
Infron unchanged, and `off` sends `none`. Levels are hints to the model and do not change
token usage predictably. The value `none` may not disable reasoning on every
provider; support depends on the model and the provider.

Reasoning text from the `reasoning_content` and `reasoning` fields is shown by
Pi. Requests use `max_tokens` (Infron clamps the value to the model limit) and
the `system` role. Strict tool schemas are enabled only for models that
report JSON mode.

### When something goes wrong

| Status | Meaning | What to do |
| --- | --- | --- |
| 400 | Request rejected | Check the content or shorten the context |
| 401 | Missing or invalid key | Run `/login` or check `INFRON_API_KEY` |
| 402 | Out of credits | Top up the account |
| 403 | Moderation | Change the input or pick another model |
| 408, 429 | Timeout or rate limit | Try again shortly |
| 502, 503 | Model or provider unavailable | Retry or choose another model with `/model` |

Messages keep the original error text and the request id. Context-overflow
errors are normalized so Pi can compact the conversation and retry.

Diagnostic steps: run `/infron`, run `/login` again if the key was rejected,
top up when the balance is empty or a `:free` model needs $5, or select a
different model.

### Privacy and security

- Pi packages run code with the user's permissions, so review the source
  before installing.
- When an Infron model is selected, the conversation, tool calls, and
  supported images are sent to Infron and to the provider serving that model.
- The key is kept in Pi's credential store after `/login`, or read from
  `INFRON_API_KEY`. The extension does not log keys or the account name
  returned by the balance endpoint, and contains no telemetry.

### Development and tests

```bash
npm ci
npm run verify
```

`verify` runs type checking, unit tests with mocked networking, an audit of
the package contents (including a secret scan), installation of the built
package in a clean environment, and a model listing through the real Pi CLI.
CI does the same on Node.js 22.19.0 and 24.x.

```bash
npm test                 # unit tests
npm run test:watch       # tests in watch mode
npm run test:live        # optional tests against the live API
npm run pack:check       # package contents and secret scan
npm run smoke:pack       # package install and real Pi CLI test
```

Live tests always check the public catalog. With `INFRON_API_KEY` they also
check the key, and the completion, tool, and reasoning checks run only when
the models are given explicitly:

```bash
INFRON_API_KEY=your-key \
INFRON_TEST_MODEL=provider/chat-model \
INFRON_TOOL_TEST_MODEL=provider/tool-model \
INFRON_REASONING_TEST_MODEL=provider/reasoning-model \
npm run test:live
```

### Limitations

- Only the Chat Completions endpoint is used. Responses-only models, plus
  embedding, image, video, and audio models, are not registered.
- Provider routing, service tiers, and bring-your-own provider keys are not
  available.
- All text models outside the short exception list offer thinking levels,
  including models that do not reason. Those models ignore the setting.
- The effective context of a request can be lower than the registered one if a
  provider changes its limits.
