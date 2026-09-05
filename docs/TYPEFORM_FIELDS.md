# Typeform — Field Specification

Конфигурация за Typeform заявка форма (алтернатива на Telegram бот за уеб-базирани заявки).

## Форма структура

### 1. Welcome Screen
- **Title**: "DRUM — по-евтини доставки между градовете"
- **Description**: "Координираме свободен капацитет в коли, които вече пътуват."
- **Button**: "Започни"

### 2. Коридор (Multiple Choice)
- **Field type**: Multiple choice (single select)
- **Question**: "Избери коридор:"
- **Choices**:
  - София → Пловдив (€10)
  - Пловдив → София (€10)
  - София → Варна (€15)
  - Варна → София (€15)

### 3. Описание на пратката (Long Text)
- **Field type**: Long text
- **Question**: "Опиши пратката (размер, тегло, съдържание):"
- **Required**: Yes
- **Validation**: Min 5 characters
- **Placeholder**: "Малък пакет, 2 kg, телефон за ремонт"

### 4. Стойност (Number)
- **Field type**: Number
- **Question**: "Каква е стойността на пратката в EUR?"
- **Required**: Yes
- **Validation**: Min 1, Max 500
- **Placeholder**: "50"

### 5. Срок (Multiple Choice)
- **Field type**: Multiple choice (single select)
- **Question**: "До кога трябва да бъде доставена?"
- **Choices**:
  - Днес
  - Утре
  - До 3 дни
  - До 7 дни

### 6. Контакт (Phone Number)
- **Field type**: Phone number
- **Question**: "Телефон за връзка:"
- **Required**: Yes

### 7. Confirmation (Statement + Payment)
- **Field type**: Statement
- **Text**: "Потвърди заявката: {{коридор}}, {{описание}}, €{{стойност}}, срок: {{срок}}. Общо: €{{total}}"
- **Payment field**: Stripe integration (€{{total}})

### 8. Thank You Screen
- **Title**: "Заявката е създадена!"
- **Description**: "Ще получиш SMS/Telegram съобщение с детайли за превозвача в следващите 24 часа."
- **Button**: "Готово"

## Логика и Conditional Rules

### Price calculation (чрез Typeform Variables)
```
base = IF(коридор contains "Пловдив", 10, IF(коридор contains "Варна", 15, 10))
fee = base * 0.15
insurance = base * 0.05
total = base + fee + insurance
```

### Conditional skip
- Ако стойност > €100 → покажи warning: "Пратки над €100 изискват verified Trust Score (≥70)"

## Stripe Integration

1. В Typeform: Connect → Stripe → Login
2. Payment field type: "Stripe Payment"
3. Amount: Variable → `total`
4. Description: "DRUM delivery: {{коридор}}"
5. Capture mode: **Authorize** (не immediate charge) — за escrow

## Webhook към Airtable

Typeform webhook ще изпраща JSON към Node.js endpoint:

```
POST /webhooks/typeform
{
  "form_response": {
    "answers": [
      { "field": { "id": "corridor" }, "text": "София → Пловдив" },
      { "field": { "id": "description" }, "text": "..." },
      ...
    ],
    "hidden": {
      "telegram_id": "123456789",
      "stripe_payment_intent": "pi_..."
    }
  }
}
```

Този endpoint ще:
1. Създаде shipment в Airtable
2. Изпрати известие в Telegram ops channel
3. Изпрати confirmation на изпращача (ако е свързан Telegram акаунт)

## Typeform Plan

- **Essentials**: $25/месец — достатъчен за MVP
  - Unlimited responses
  - Logic jumps
  - Stripe integration
  - Webhooks
- **Professional**: $50/месец — за scaling
  - Custom variables
  - Multiple endings

## Альтернатива: Tally.so

Tally.so е безплатна алтернатива с подобна функционалност:
- Free tier: unlimited forms, Stripe integration
- Лесен UI
- Webhooks

Препоръка: започни с Tally.so (free), мигрирай към Typeform ако имаш нужда от advanced logic.
