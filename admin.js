
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const products = new Map();

let editingId = null;
let unsubscribe = null;

function message(text, error = false) {
  $("message").textContent = text;
  $("message").style.color = error ? "#ff8f85" : "#a6edaf";
}

function errorText(error) {
  const messages = {
    "auth/invalid-credential": "الإيميل أو كلمة المرور غير صحيحة.",
    "auth/too-many-requests": "محاولات كثيرة. حاول لاحقًا.",
    "permission-denied": "مفيش صلاحية للعملية دي. راجع قواعد Firestore."
  };

  return messages[error.code] || error.message || "حصل خطأ غير متوقع.";
}

function validImage(value) {
  return typeof value === "string" &&
    (value.startsWith("data:image/") || value.startsWith("https://"));
}

function resetForm() {
  editingId = null;
  $("productForm").reset();
  $("emoji").value = "🍕";
  $("available").checked = true;
  $("removeImage").checked = false;
  $("preview").removeAttribute("src");
  $("preview").style.display = "none";
  $("formTitle").textContent = "إضافة صنف جديد";
  $("saveBtn").textContent = "حفظ الصنف";
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return reject(new Error("اختار صورة JPG أو PNG أو WebP."));
    }

    if (file.size > 10 * 1024 * 1024) {
      return reject(new Error("حجم الصورة أكبر من 10 ميجابايت."));
    }

    const reader = new FileReader();

    reader.onerror = () => reject(new Error("تعذر قراءة الصورة."));

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error("الصورة غير صالحة."));

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSide = 800;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));

        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        canvas.getContext("2d").drawImage(
          img, 0, 0, canvas.width, canvas.height
        );

        let quality = 0.82;
        let result = canvas.toDataURL("image/jpeg", quality);

        while (result.length > 600000 && quality > 0.32) {
          quality -= 0.1;
          result = canvas.toDataURL("image/jpeg", quality);
        }

        if (result.length > 600000) {
          return reject(new Error("الصورة كبيرة بعد الضغط. جرّب صورة أصغر."));
        }

        resolve(result);
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

$("image").addEventListener("change", async () => {
  const file = $("image").files[0];
  if (!file) return;

  try {
    const result = await compressImage(file);
    $("preview").src = result;
    $("preview").style.display = "block";
    message("");
  } catch (error) {
    $("image").value = "";
    message(error.message, true);
  }
});

function makeButton(label, handler, className = "btn secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderProducts() {
  const container = $("items");
  container.replaceChildren();

  const list = [...products.entries()];

  $("count").textContent = `${list.length} صنف`;

  if (!list.length) {
    container.textContent = "مفيش منتجات لسه. أضف أول صنف من النموذج.";
    return;
  }

  for (const [id, product] of list) {
    const item = document.createElement("div");
    item.className = "item";

    if (validImage(product.image)) {
      const img = document.createElement("img");
      img.src = product.image;
      img.alt = product.name || "صورة الصنف";
      item.append(img);
    }

    const info = document.createElement("div");
    info.className = "info";

    const name = document.createElement("strong");
    name.textContent = `${product.emoji || "🍕"} ${product.name || ""}`;

    const details = document.createElement("small");
    details.textContent =
      `${Number(product.price || 0)} جنيه · ` +
      `${product.available === false ? "غير متاح" : "متاح"}`;

    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "actions";

    actions.append(
      makeButton("تعديل", () => editProduct(id)),
      makeButton("حذف", () => removeProduct(id), "btn warn")
    );

    item.append(info, actions);
    container.append(item);
  }
}

function editProduct(id) {
  const product = products.get(id);
  if (!product) return;

  editingId = id;

  $("name").value = product.name || "";
  $("price").value = product.price ?? "";
  $("category").value = product.category || "pizza";
  $("emoji").value = product.emoji || "🍕";
  $("desc").value = product.desc || "";
  $("available").checked = product.available !== false;
  $("removeImage").checked = false;
  $("image").value = "";

  if (validImage(product.image)) {
    $("preview").src = product.image;
    $("preview").style.display = "block";
  } else {
    $("preview").removeAttribute("src");
    $("preview").style.display = "none";
  }

  $("formTitle").textContent = "تعديل الصنف";
  $("saveBtn").textContent = "حفظ التعديلات";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function removeProduct(id) {
  const product = products.get(id);

  if (!product) return;

  if (!confirm(`متأكد إنك عايز تحذف ${product.name}؟`)) return;

  try {
    await deleteDoc(doc(db, "products", id));

    if (editingId === id) resetForm();

    message("تم حذف الصنف بنجاح.");
  } catch (error) {
    message(errorText(error), true);
  }
}

$("productForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("saveBtn");
  const price = Number($("price").value);

  if (!Number.isFinite(price) || price < 0 || price > 100000) {
    message("اكتب سعرًا صحيحًا.", true);
    return;
  }

  button.disabled = true;
  message("جاري حفظ الصنف...");

  try {
    const file = $("image").files[0];

    let image = editingId
      ? products.get(editingId)?.image || ""
      : "";

    if ($("removeImage").checked) image = "";
    if (file) image = await compressImage(file);

    const data = {
      name: $("name").value.trim(),
      price,
      category: $("category").value,
      emoji: $("emoji").value.trim() || "🍕",
      desc: $("desc").value.trim(),
      image,
      available: $("available").checked,
      updatedAt: serverTimestamp()
    };

    if (!data.name) throw new Error("اكتب اسم الصنف.");

    if (editingId) {
      await updateDoc(doc(db, "products", editingId), data);
      message("تم تعديل الصنف بنجاح.");
    } else {
      await addDoc(collection(db, "products"), {
        ...data,
        createdAt: serverTimestamp()
      });

      message("تم إضافة الصنف بنجاح.");
    }

    resetForm();
  } catch (error) {
    message(errorText(error), true);
  } finally {
    button.disabled = false;
  }
});

$("resetBtn").addEventListener("click", resetForm);

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    message("جاري تسجيل الدخول...");

    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );

    $("password").value = "";
  } catch (error) {
    message(errorText(error), true);
  }
});

$("logout").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async user => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  $("login").style.display = user ? "none" : "block";
  $("workspace").style.display = "none";

  products.clear();
  renderProducts();
  resetForm();

  if (!user) {
    message("");
    return;
  }

  try {
    const adminRef = doc(db, "admins", user.uid);
    const adminSnap = await getDoc(adminRef);

    if (!adminSnap.exists() || adminSnap.data().enabled !== true) {
      message("الحساب ده مش عنده صلاحية الإدارة.", true);
      await signOut(auth);
      return;
    }

    if (auth.currentUser?.uid !== user.uid) return;

    $("login").style.display = "none";
    $("workspace").style.display = "block";
    $("who").textContent = user.email || "حساب الإدارة";

    message("تم تسجيل الدخول بنجاح.");

    unsubscribe = onSnapshot(
      collection(db, "products"),
      snapshot => {
        products.clear();

        snapshot.forEach(productDoc => {
          products.set(productDoc.id, productDoc.data());
        });

        renderProducts();
      },
      error => {
        message(errorText(error), true);
      }
    );
  } catch (error) {
    message(errorText(error), true);
    $("login").style.display = "block";
    $("workspace").style.display = "none";
  }
});
