const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  whatsappId: { type: String, unique: true, required: true },
  nom: { type: String, default: '' },
  derniereCommande: { type: Date, default: null },
  commandes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Commande' }]
}, { timestamps: true });

const commandeSchema = new mongoose.Schema({
  numeroCommande: { type: String, unique: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  whatsappId: { type: String, required: true },
  produits: [{
    produitKey: String,
    nom: String,
    emoji: String,
    quantite: Number,
    prix: Number
  }],
  sousTotal: { type: Number, required: true },
  typeRecuperation: { type: String, enum: ['livraison', 'retrait'], default: null },
  adresse: { type: String, default: '' },
  pointRepere: { type: String, default: '' },
  fraisLivraison: { type: Number, default: null },
  totalFinal: { type: Number, default: null },
  statut: { 
    type: String, 
    enum: ['en_attente', 'confirmee', 'en_preparation', 'prete', 'livree', 'annulee'],
    default: 'en_attente' 
  }
}, { timestamps: true });

const Client = mongoose.model('Client', clientSchema);
const Commande = mongoose.model('Commande', commandeSchema);

module.exports = { Client, Commande };