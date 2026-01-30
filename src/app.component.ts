import { Component, inject, signal, computed, effect, ViewChild, ElementRef, SecurityContext } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from './services/gemini.service';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

// --- Interfaces ---
interface SubjectModel {
  id: string;
  name: string; // Nome definito dall'utente
  prompt: string; // Il prompt usato o la descrizione dell'immagine caricata
  imageUrl: string; // Rappresentazione Base64
  createdAt: number;
}

interface Project {
  id: string;
  type: 'image' | 'video';
  subjectIds: string[];
  scenePrompt: string;
  resultUrl: string | SafeUrl; 
  createdAt: number;
  status: 'generating' | 'completed' | 'failed';
  aspectRatio: string;
  effectName?: string; // Track which effect was used
}

interface EffectOption {
  id: string;
  label: string;
  icon: string;
  prompt: string;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: [] 
})
export class AppComponent {
  private gemini = inject(GeminiService);
  private sanitizer = inject(DomSanitizer);

  // --- State Signals ---
  activeTab = signal<'lab' | 'gallery' | 'studio' | 'showcase'>('lab');
  
  // Data
  subjects = signal<SubjectModel[]>([]);
  projects = signal<Project[]>([]);
  
  // Selection (Multiple)
  selectedSubjectIds = signal<Set<string>>(new Set());
  
  // Computed Helpers
  selectedSubjects = computed(() => {
    const ids = this.selectedSubjectIds();
    return this.subjects().filter(s => ids.has(s.id));
  });

  // Il primo soggetto selezionato è il "Primary" per i riferimenti video
  primarySubject = computed(() => this.selectedSubjects()[0] || null);
  
  // Inputs
  newSubjectName = signal('');
  newSubjectPrompt = signal('');
  newProjectPrompt = signal('');
  isGenerating = signal(false);
  generationStatus = signal<string>('');
  
  // Aspect Ratio Settings
  availableAspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  selectedAspectRatio = signal<string>('16:9');

  // --- Visual Effects Configuration ---
  
  imageEffects: EffectOption[] = [
    { id: 'none', label: 'Nessuno', icon: 'fa-ban', prompt: '' },
    { id: 'fog', label: 'Nebbia Volumetrica', icon: 'fa-cloud', prompt: 'Atmospheric heavy fog, mysterious volumetric lighting, haze, depth, cinematic atmosphere' },
    { id: 'smoke', label: 'Fumo Denso', icon: 'fa-smog', prompt: 'Thick swirling smoke, dramatic shadows, high contrast, dark atmosphere' },
    { id: 'laser', label: 'Luci Laser', icon: 'fa-bolt', prompt: 'Neon laser beams cutting through darkness, cyberpunk aesthetic, vibrant glowing lines, sci-fi club atmosphere' },
    { id: 'pointnclick', label: 'Punta & Clicca 90s', icon: 'fa-computer-mouse', prompt: 'Retro 90s point and click adventure game style, pixel art aesthetic, VGA color palette, dithered shading' },
    { id: 'noir', label: 'Film Noir', icon: 'fa-hat-cowboy', prompt: 'Black and white photography, high contrast, film grain, dramatic shadows, detective movie style' },
    { id: 'hologram', label: 'Ologramma', icon: 'fa-ghost', prompt: 'Translucent holographic projection style, scanlines, digital interference, blue glowing edges' }
  ];

  videoEffects: EffectOption[] = [
    { id: 'none', label: 'Nessuno', icon: 'fa-ban', prompt: '' },
    { id: 'vhs', label: 'VHS Glitch', icon: 'fa-tape', prompt: 'Analog video aesthetic, VHS tracking error, chromatic aberration, low fidelity 90s footage, magnetic tape distortion' },
    { id: 'glow', label: 'Dreamy Glow', icon: 'fa-sun', prompt: 'Soft focus, intense bloom effect, ethereal lighting, dream sequence, angelic aura' },
    { id: 'cyber', label: 'Cyber Glitch', icon: 'fa-microchip', prompt: 'Digital video corruption, datamoshing, pixel sorting artifacts, cyberpunk glitch art, stuttering visual data' },
    { id: 'matrix', label: 'Digital Rain', icon: 'fa-code', prompt: 'Green digital code overlay, sci-fi matrix atmosphere, streaming data visualization' }
  ];

  selectedImageEffect = signal<EffectOption>(this.imageEffects[0]);
  selectedVideoEffect = signal<EffectOption>(this.videoEffects[0]);

  // Upload Handling
  uploadedImageBase64 = signal<string | null>(null);

  // Fullscreen Modal State
  selectedProject = signal<Project | null>(null);
  
  // Edit Mode State - Stores the entire project being referenced
  editingProject = signal<Project | null>(null);

  // --- Computed ---
  sortedSubjects = computed(() => [...this.subjects()].sort((a, b) => b.createdAt - a.createdAt));
  sortedProjects = computed(() => [...this.projects()].sort((a, b) => b.createdAt - a.createdAt));

  constructor() {
    // Load data
    const savedSubjects = localStorage.getItem('holo_lab_subjects_v2');
    if (savedSubjects) {
      this.subjects.set(JSON.parse(savedSubjects));
    }
    const savedProjects = localStorage.getItem('holo_lab_projects_v2');
    if (savedProjects) {
       // Note: In a real app we'd need to re-sanitize or handle URLs better
    }
    
    // Auto-save effect
    effect(() => {
      localStorage.setItem('holo_lab_subjects_v2', JSON.stringify(this.subjects()));
    });
  }

  // --- Actions: Navigation ---
  setView(view: 'lab' | 'gallery' | 'studio' | 'showcase') {
    this.activeTab.set(view);
  }

  // --- Actions: Selection ---
  toggleSubject(id: string) {
    this.selectedSubjectIds.update(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  
  clearSelection() {
    this.selectedSubjectIds.set(new Set());
  }

  deleteSubject(id: string, event: Event) {
    event.stopPropagation();
    if(confirm('Eliminare definitivamente questo modello?')) {
      this.subjects.update(prev => prev.filter(s => s.id !== id));
      this.selectedSubjectIds.update(prev => {
         const next = new Set(prev);
         next.delete(id);
         return next;
      });
    }
  }

  // --- Actions: File Upload ---
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.uploadedImageBase64.set(e.target.result);
        // Suggerimento automatico per il nome se vuoto
        if (!this.newSubjectName()) {
            this.newSubjectName.set(file.name.split('.')[0]);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  clearUpload() {
    this.uploadedImageBase64.set(null);
  }

  // --- Actions: Creation & Analysis ---

  async analyzeSubject() {
    if (!this.uploadedImageBase64() && !this.newSubjectPrompt()) return;
    
    this.isGenerating.set(true);
    this.generationStatus.set('Gemini 2.5 Flash: Scansione Elementi Visivi...');

    try {
      const extractedPrompt = await this.gemini.refineCharacterPrompt(
        this.uploadedImageBase64(), 
        this.newSubjectPrompt()
      );
      this.newSubjectPrompt.set(extractedPrompt);
      this.generationStatus.set('Analisi Completata.');
    } catch (err) {
      alert('Analisi Fallita: ' + err);
    } finally {
      this.isGenerating.set(false);
      setTimeout(() => this.generationStatus.set(''), 2000);
    }
  }

  async createSubject() {
    if (!this.newSubjectName()) return;
    if (!this.uploadedImageBase64() && !this.newSubjectPrompt()) return;
    
    this.isGenerating.set(true);
    this.generationStatus.set('Salvataggio Modello...');

    try {
      let imageUrl = '';
      if (this.uploadedImageBase64()) {
         imageUrl = this.uploadedImageBase64()!;
      } else {
         this.generationStatus.set('Generazione Anteprima Asset...');
         imageUrl = await this.gemini.generateSubjectModel(this.newSubjectPrompt());
      }
      
      let finalPrompt = this.newSubjectPrompt();
      if (!finalPrompt && this.uploadedImageBase64()) {
         this.generationStatus.set('Auto-Tagging con Flash...');
         finalPrompt = await this.gemini.refineCharacterPrompt(this.uploadedImageBase64(), "");
      }
      
      const newSubject: SubjectModel = {
        id: crypto.randomUUID(),
        name: this.newSubjectName(),
        prompt: finalPrompt,
        imageUrl: imageUrl,
        createdAt: Date.now()
      };

      this.subjects.update(prev => [newSubject, ...prev]);
      
      this.newSubjectName.set('');
      this.newSubjectPrompt.set('');
      this.uploadedImageBase64.set(null);
      
      this.toggleSubject(newSubject.id);
      this.setView('gallery'); 
    } catch (err) {
      alert('Creazione Fallita: ' + err);
    } finally {
      this.isGenerating.set(false);
      this.generationStatus.set('');
    }
  }

  async createProject(type: 'image' | 'video') {
    const squad = this.selectedSubjects();
    const prompt = this.newProjectPrompt();
    const ratio = this.selectedAspectRatio();
    
    if (squad.length === 0 || !prompt) return;

    this.isGenerating.set(true);
    
    // Always create a NEW project ID to preserve history
    const projectId = crypto.randomUUID();
    const subjectIds = squad.map(s => s.id);
    
    // Determine Effect Prompt
    let effectPrompt = "";
    let effectNameLabel = "";
    
    if (type === 'image') {
       effectPrompt = this.selectedImageEffect().prompt;
       effectNameLabel = this.selectedImageEffect().label;
    } else {
       effectPrompt = this.selectedVideoEffect().prompt;
       effectNameLabel = this.selectedVideoEffect().label;
    }

    // Costruzione Prompt Combinato
    let fullPrompt = "";
    if (squad.length === 1) {
        fullPrompt = `Character Reference Description: ${squad[0].prompt}. \n\nTarget Scene: ${prompt}.`;
    } else {
        const charDescriptions = squad.map((s, i) => `[Character ${i+1} (${s.name}) Visual Data: ${s.prompt}]`).join("\n");
        fullPrompt = `Scene with multiple characters:\n${charDescriptions}\n\nTarget Scene Description: ${prompt}.\nEnsure coherent interaction based on Visual Data provided.`;
    }

    // Append Effect Instructions if present
    if (effectPrompt) {
        fullPrompt += `\n\nVISUAL STYLE / POST-PROCESSING INSTRUCTIONS: Apply the following style strictly: ${effectPrompt}.`;
    }

    const newProject: Project = {
      id: projectId,
      type,
      subjectIds: subjectIds,
      scenePrompt: prompt,
      resultUrl: '',
      createdAt: Date.now(),
      status: 'generating',
      aspectRatio: ratio,
      effectName: effectNameLabel !== 'Nessuno' ? effectNameLabel : undefined
    };
    
    // Add to top of list
    this.projects.update(prev => [newProject, ...prev]);
    
    // Clean up edit mode logic (we are done referring to the old one)
    this.editingProject.set(null);
    this.setView('showcase'); 

    try {
      if (type === 'video') {
        this.generationStatus.set(`Veo 2.0: Generazione Clip (${ratio}) + FX...`);
        const primary = this.primarySubject(); 
        if (!primary) throw new Error("Nessun soggetto primario trovato.");

        const videoPrompt = `${fullPrompt} (Output aspect ratio: ${ratio}, Cinematic, High Quality)`;
        const videoUrl = await this.gemini.generateSceneVideo(primary.imageUrl, videoPrompt);
        const safeUrl = this.sanitizer.bypassSecurityTrustUrl(videoUrl);
        this.updateProjectStatus(projectId, 'completed', safeUrl);
      } else {
        this.generationStatus.set(`Imagen 4.0: Rendering Scena (${ratio}) + FX...`);
        const imageUrl = await this.gemini.generateSceneImage(fullPrompt, ratio);
        this.updateProjectStatus(projectId, 'completed', imageUrl);
      }
    } catch (err) {
      console.error(err);
      this.updateProjectStatus(projectId, 'failed', '');
      alert('Missione Fallita: ' + err);
    } finally {
      this.isGenerating.set(false);
      this.generationStatus.set('');
      this.newProjectPrompt.set('');
    }
  }

  updateProjectStatus(id: string, status: 'completed' | 'failed', resultUrl: string | SafeUrl) {
    this.projects.update(prev => prev.map(p => 
      p.id === id ? { ...p, status, resultUrl } : p
    ));
  }
  
  remixProject(project: Project, event: Event) {
    event.stopPropagation();
    
    // Set edit mode with FULL project object
    this.editingProject.set(project);

    // 1. Restore Subject Selection
    this.selectedSubjectIds.set(new Set(project.subjectIds));
    
    // 2. Restore Prompt
    this.newProjectPrompt.set(project.scenePrompt);
    
    // 3. Restore Ratio (if exists)
    if (project.aspectRatio) {
      this.selectedAspectRatio.set(project.aspectRatio);
    }
    
    // Reset Effects on Remix (User chooses new effect)
    this.selectedImageEffect.set(this.imageEffects[0]);
    this.selectedVideoEffect.set(this.videoEffects[0]);
    
    // 4. Navigate to Studio
    this.setView('studio');
  }

  cancelEdit() {
    this.editingProject.set(null);
    this.newProjectPrompt.set('');
    this.selectedAspectRatio.set('16:9');
  }

  deleteProject(id: string, event: Event) {
    event.stopPropagation();
    // Native Toast/Dialog simulation
    if (confirm("Sei sicuro di voler eliminare questa scena dall'archivio?")) {
      this.projects.update(prev => prev.filter(p => p.id !== id));
      if (this.selectedProject()?.id === id) {
        this.closeFullscreen();
      }
    }
  }

  openFullscreen(project: Project) {
    if (project.status === 'completed') {
      this.selectedProject.set(project);
    }
  }

  closeFullscreen() {
    this.selectedProject.set(null);
  }

  getProjectSubjectNames(subjectIds: string[]): string {
    return subjectIds
      .map(id => this.subjects().find(s => s.id === id)?.name || 'Sconosciuto')
      .join(', ');
  }
  
  getSafeUrl(url: string | SafeUrl): SafeUrl {
    if (typeof url !== 'string') return url;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
  
  setAspectRatio(ratio: string) {
    this.selectedAspectRatio.set(ratio);
  }

  setImageEffect(effect: EffectOption) {
    this.selectedImageEffect.set(effect);
  }

  setVideoEffect(effect: EffectOption) {
    this.selectedVideoEffect.set(effect);
  }
}