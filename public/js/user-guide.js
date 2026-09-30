/**
 * Guide utilisateur simplifié pour non-développeurs
 * Interface simple avec termes et explications accessibles
 */

// Fonction pour afficher des tooltips simples
function showSimpleTooltip(element, message) {
  const tooltip = document.createElement('div');
  tooltip.className = 'simple-tooltip';
  tooltip.textContent = message;
  tooltip.style.cssText = `
    position: absolute;
    background: #333;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 13px;
    z-index: 10000;
    max-width: 250px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  
  const rect = element.getBoundingClientRect();
  tooltip.style.top = (rect.bottom + 8) + 'px';
  tooltip.style.left = rect.left + 'px';
  
  document.body.appendChild(tooltip);
  
  setTimeout(() => {
    tooltip.style.opacity = '0';
    tooltip.style.transition = 'opacity 0.3s';
    setTimeout(() => tooltip.remove(), 300);
  }, 3000);
}

// Dictionnaire de termes techniques vers termes simples
const simpleTerms = {
  'FATAL': '⚠️ Critique - Problème grave',
  'CRITICAL': '🔴 Critique - Problème important',
  'ERROR': '❌ Erreur - Problème à corriger',
  'WARNING': '⚠️ Attention - Problème potentiel',
  'INFO': 'ℹ️ Information - Message normal',
  'DEBUG': '🔧 Technique - Pour développeurs',
  'logs': 'enregistrements',
  'timestamp': 'date et heure',
  'source': 'origine',
  'service': 'service',
  'fingerprint': 'identifiant unique',
  'import': 'importation',
  'dashboard': 'tableau de bord',
  'alert': 'notification',
  'occurrence': 'apparition',
  'severity': 'gravité'
};

// Fonction pour simplifier les termes affichés
function simplifyTerm(term) {
  return simpleTerms[term] || term;
}

// Ajouter des aides contextuelles sur les éléments importants
function addContextualHelp() {
  // Aide sur les KPI cards
  document.querySelectorAll('.kpi-card-v2').forEach(card => {
    card.addEventListener('mouseenter', function() {
      const label = this.querySelector('.kpi-label-v2');
      if (label) {
        const labelText = label.textContent.toLowerCase();
        let helpText = '';
        
        if (labelText.includes('total')) {
          helpText = 'Nombre total d\'enregistrements dans le système';
        } else if (labelText.includes('aujourd\'hui') || labelText.includes('today')) {
          helpText = 'Enregistrements ajoutés aujourd\'hui';
        } else if (labelText.includes('erreur')) {
          helpText = 'Problèmes détectés cette semaine';
        } else if (labelText.includes('alerte')) {
          helpText = 'Notifications importantes non lues';
        } else if (labelText.includes('fatal') || labelText.includes('critical')) {
          helpText = 'Problèmes les plus graves';
        } else if (labelText.includes('source')) {
          helpText = 'Origines différentes des enregistrements';
        } else if (labelText.includes('taille')) {
          helpText = 'Espace utilisé par les enregistrements';
        }
        
        if (helpText) {
          showSimpleTooltip(this, helpText);
        }
      }
    });
  });
  
  // Aide sur les badges de niveau
  document.querySelectorAll('.lvl').forEach(badge => {
    badge.addEventListener('mouseenter', function() {
      const level = this.textContent;
      const simpleLevel = simplifyTerm(level);
      showSimpleTooltip(this, simpleLevel);
    });
  });
  
  // Aide sur les boutons d'action
  document.querySelectorAll('button').forEach(button => {
    if (button.textContent.includes('Export')) {
      button.addEventListener('mouseenter', function() {
        showSimpleTooltip(this, 'Télécharger les données au format CSV');
      });
    } else if (button.textContent.includes('Filtrer') || button.textContent.includes('Filter')) {
      button.addEventListener('mouseenter', function() {
        showSimpleTooltip(this, 'Afficher uniquement certains résultats');
      });
    }
  });
}

// Fonction pour afficher un guide de démarrage pour nouveaux utilisateurs
function showBeginnerGuide() {
  const hasSeenGuide = localStorage.getItem('beginnerGuideSeen');
  if (hasSeenGuide) return;
  
  const guide = document.createElement('div');
  guide.className = 'beginner-guide';
  guide.innerHTML = `
    <div class="guide-content">
      <h3>👋 Bienvenue sur LogSystem !</h3>
      <p>Voici comment utiliser la plateforme simplement :</p>
      <ul>
        <li><strong>📊 Tableau de bord</strong> : Vue d'ensemble de vos enregistrements</li>
        <li><strong>🔴 Erreurs</strong> : Problèmes qui nécessitent votre attention</li>
        <li><strong>🚨 Alertes</strong> : Notifications importantes en temps réel</li>
        <li><strong>📥 Import</strong> : Ajoutez vos fichiers d'enregistrements ici</li>
        <li><strong>🔍 Recherche</strong> : Trouvez facilement ce que vous cherchez</li>
      </ul>
      <button id="close-guide">Compris !</button>
    </div>
  `;
  
  guide.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100000;
  `;
  
  const content = guide.querySelector('.guide-content');
  content.style.cssText = `
    background: var(--surface);
    padding: 30px;
    border-radius: 12px;
    max-width: 500px;
    color: var(--text);
  `;
  
  guide.querySelector('#close-guide').addEventListener('click', () => {
    guide.remove();
    localStorage.setItem('beginnerGuideSeen', 'true');
  });
  
  document.body.appendChild(guide);
}

// Initialiser quand le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    addContextualHelp();
    showBeginnerGuide();
  });
} else {
  addContextualHelp();
  showBeginnerGuide();
}

// Exporter les fonctions pour utilisation ailleurs
window.userGuide = {
  simplifyTerm,
  showSimpleTooltip,
  addContextualHelp
};