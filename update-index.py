from pathlib import Path

path = Path('index.html')
if not path.exists():
    raise SystemExit('Erreur : index.html introuvable. Placez ce script dans le dossier du projet Isidore AI.')
s = path.read_text(encoding='utf-8')
replacements = {
    '<title>IsidoreAI</title>': '<title>Isidore AI</title>',
    '<div class="logo">🤖 Isidore<span>AI</span></div>': '<div class="logo">🤖 Isidore <span>AI</span></div>',
    '<div class="sidebar-title">IsidoreAI</div>': '<div class="sidebar-title">Isidore AI</div>',
    'À propos d’IsidoreAI': 'À propos d’Isidore AI',
    '<h1>Bonjour, je suis IsidoreAI</h1>': '<h1>Bonjour, je suis Isidore AI</h1>',
    '<p>IsidoreAI est un assistant intelligent pour l’apprentissage, les mathématiques, les sciences et l’éducation technique.</p>': '<p>Isidore AI est un assistant intelligent pour l’apprentissage, les mathématiques, les sciences et l’éducation technique.</p>',
    'name.textContent = "IsidoreAI";': 'name.textContent = "Isidore AI";',
    'alt = "Image envoyée à IsidoreAI"': 'alt = "Image envoyée à Isidore AI"',
}
for old, new in replacements.items():
    if old not in s:
        print(f'Avertissement : texte non trouvé (peut-être déjà modifié) : {old}')
    s = s.replace(old, new)
old_body = '''        problem: question || "Analyse l’image jointe et réponds à la question implicite si aucune consigne n’est écrite.",
        image: imageForSending ? {'''
new_body = '''        problem: question || "Analyse l’image jointe et réponds à la question implicite si aucune consigne n’est écrite.",
        // Envoie les tours précédents, sans répéter le message actuel qui vient d’être ajouté.
        history: current.messages.slice(0, -1)
          .filter(message => (message.role === "user" || message.role === "assistant") && !message.error)
          .slice(-16)
          .map(message => ({ role: message.role, text: String(message.text || "").slice(0, 4000) })),
        image: imageForSending ? {'''
if old_body in s:
    s = s.replace(old_body, new_body, 1)
elif 'history: current.messages.slice(0, -1)' not in s:
    raise SystemExit('Erreur : emplacement de la requête API introuvable. index.html non enregistré; appliquez la modification manuellement.')
path.write_text(s, encoding='utf-8')
print('Mise à jour terminée : noms visibles harmonisés et historique récent transmis à /api/solve.')
print('Le style CSS et la disposition de la page n’ont pas été modifiés.')
