curl -X POST \
https://graph.facebook.com/v25.0/1110901568774156/messages \
-H "Authorization: Bearer EAANGT4QvGUIBRUqN57oIQ52yvBLrbTd4A6359W8xSjv05ozMzBhukvvo0v4NuOKDzBYIbCOOXWB0O41kRXGZCrZBzL4yYMxFagNWsAYoCIqrxMWyzP936abfxxAR1GLACNlIuiKld1ZBRO2UMukEez9oTQtA4RjJ9vLNKNAwvSsGzKMFaUupaOMSZBUVplYVOSZADDX5YnlipL6le543pcfo7102IZB4s2ZC8ukuEFQwgrbzu6HRNvfLpYbkODTLYzEzeus163Ezx6djMRZCXhJa" \
-H "Content-Type: application/json" \
-d '{
  "messaging_product": "whatsapp",
  "to": "41779470575",
  "type": "text",
  "text": {
    "body": "سلام، این پیام تست واتساپ API است"
  }
}'





curl -X POST \
https://graph.facebook.com/v25.0/1110901568774156/messages \
-H "Authorization: Bearer EAANGT4QvGUIBRUqN57oIQ52yvBLrbTd4A6359W8xSjv05ozMzBhukvvo0v4NuOKDzBYIbCOOXWB0O41kRXGZCrZBzL4yYMxFagNWsAYoCIqrxMWyzP936abfxxAR1GLACNlIuiKld1ZBRO2UMukEez9oTQtA4RjJ9vLNKNAwvSsGzKMFaUupaOMSZBUVplYVOSZADDX5YnlipL6le543pcfo7102IZB4s2ZC8ukuEFQwgrbzu6HRNvfLpYbkODTLYzEzeus163Ezx6djMRZCXhJa" \
-H "Content-Type: application/json" \
-d '{
  "messaging_product": "whatsapp",
  "to": "41794880011",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": {
      "code": "en_US"
    }
  }
}'