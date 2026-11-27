const http = require("http");
const admin = require("firebase-admin");

// La clave se lee de una variable de entorno, no del código
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const messaging = admin.messaging();

// Render necesita un puerto abierto para mantener el servicio activo
http
  .createServer((req, res) => res.end("Spark server OK"))
  .listen(process.env.PORT || 3000);

let initialized = false;
const seen = new Map();

db.collection("chats").onSnapshot(
  (snap) => {
    // La primera vez solo guardo el estado actual, sin avisar de mensajes viejos
    if (!initialized) {
      snap.docs.forEach((d) => seen.set(d.id, d.get("lastTime") || 0));
      initialized = true;
      console.log("Listo, escuchando chats:", snap.size);
      return;
    }

    snap.docChanges().forEach(async (change) => {
      if (change.type === "removed") return;

      const data = change.doc.data();
      const lastTime = data.lastTime || 0;
      const lastFrom = data.lastFrom || "";
      const prev = seen.get(change.doc.id) || 0;
      seen.set(change.doc.id, Math.max(prev, lastTime));

      // Solo avisar de mensajes nuevos
      if (!lastFrom || lastTime <= prev) return;

      const recipient = (data.participants || []).find((u) => u !== lastFrom);
      if (!recipient) return;

      try {
        const recipientDoc = await db.collection("users").doc(recipient).get();
        const token = recipientDoc.get("fcmToken");
        if (!token) return;

        const senderDoc = await db.collection("users").doc(lastFrom).get();
        const senderName = senderDoc.get("name") || "Nuevo mensaje";

        await messaging.send({
          token,
          notification: {
            title: senderName,
            body: data.lastText || "",
          },
          data: { chatWith: lastFrom },
          android: {
            priority: "high",
            notification: { channelId: "spark_messages" },
          },
        });
        console.log("Aviso enviado a", recipient);
      } catch (e) {
        console.error("Error al enviar aviso:", e.message);
      }
    });
  },
  (err) => console.error("Error al escuchar Firestore:", err.message)
);