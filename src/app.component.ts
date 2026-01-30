import { Component, inject, signal, computed, effect, ViewChild, ElementRef, SecurityContext, HostListener } from '@angular/core';
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

interface SceneLayer {
  id: string;       // Unique layer ID
  subjectId: string;
  x: number;        // Percentage (0-100)
  y: number;        // Percentage (0-100)
  scale: number;    // Scale factor (0.5 - 3.0)
  zIndex: number;
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

  // --- Scene Editor (Canvas) State ---
  isCanvasMode = signal(false);
  sceneLayers = signal<SceneLayer[]>([]);
  selectedLayerId = signal<string | null>(null);
  
  // Dragging State
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private activeLayerStart = { x: 0, y: 0 }; // Percentage
  
  @ViewChild('sceneCanvas') sceneCanvasRef!: ElementRef<HTMLDivElement>;

  // --- Computed ---
  sortedSubjects = computed(() => [...this.subjects()].sort((a, b) => b.createdAt - a.createdAt));
  sortedProjects = computed(() => [...this.projects()].sort((a, b) => b.createdAt - a.createdAt));
  
  activeLayer = computed(() => {
    const id = this.selectedLayerId();
    if (!id) return null;
    return this.sceneLayers().find(l => l.id === id) || null;
  });

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

  // --- SCENE EDITOR LOGIC ---

  toggleCanvasMode() {
    this.isCanvasMode.update(v => !v);
  }

  addToScene(subject: SubjectModel) {
    const newLayer: SceneLayer = {
      id: crypto.randomUUID(),
      subjectId: subject.id,
      x: 50, // Center
      y: 50, // Center
      scale: 1,
      zIndex: this.sceneLayers().length + 1
    };
    this.sceneLayers.update(prev => [...prev, newLayer]);
    this.selectedLayerId.set(newLayer.id);
  }

  removeLayer(layerId: string) {
    this.sceneLayers.update(prev => prev.filter(l => l.id !== layerId));
    if (this.selectedLayerId() === layerId) {
      this.selectedLayerId.set(null);
    }
  }

  selectLayer(layerId: string, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedLayerId.set(layerId);
    
    // Bring to front logic (optional, but good UX)
    this.sceneLayers.update(layers => {
      const maxZ = Math.max(...layers.map(l => l.zIndex), 0);
      return layers.map(l => l.id === layerId ? { ...l, zIndex: maxZ + 1 } : l);
    });
  }

  updateLayerScale(val: number) {
    const id = this.selectedLayerId();
    if (!id) return;
    this.sceneLayers.update(layers => layers.map(l => l.id === id ? { ...l, scale: val } : l));
  }

  // --- Drag & Drop Implementation ---
  
  onCanvasMouseDown(event: MouseEvent, layer: SceneLayer) {
    event.preventDefault();
    event.stopPropagation();
    this.selectLayer(layer.id);
    this.isDragging = true;
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.activeLayerStart = { x: layer.x, y: layer.y };
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent) {
    if (!this.isDragging || !this.selectedLayerId() || !this.sceneCanvasRef) return;

    const canvasRect = this.sceneCanvasRef.nativeElement.getBoundingClientRect();
    const deltaX = event.clientX - this.dragStart.x;
    const deltaY = event.clientY - this.dragStart.y;

    // Convert pixels to percentage relative to canvas size
    const percentX = (deltaX / canvasRect.width) * 100;
    const percentY = (deltaY / canvasRect.height) * 100;

    const newX = this.activeLayerStart.x + percentX;
    const newY = this.activeLayerStart.y + percentY;

    // Clamp values (roughly -50 to 150 to allow off-screen partial)
    const clampedX = Math.max(-20, Math.min(120, newX));
    const clampedY = Math.max(-20, Math.min(120, newY));

    this.sceneLayers.update(layers => 
      layers.map(l => l.id === this.selectedLayerId() ? { ...l, x: clampedX, y: clampedY } : l)
    );
  }

  @HostListener('window:mouseup')
  onWindowMouseUp() {
    this.isDragging = false;
  }
  
  // Wheel to resize when hovering selected
  onLayerWheel(event: WheelEvent, layerId: string) {
    if (this.selectedLayerId() !== layerId) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    this.sceneLayers.update(layers => 
      layers.map(l => {
        if (l.id === layerId) {
          const newScale = Math.max(0.2, Math.min(5, l.scale + delta));
          return { ...l, scale: newScale };
        }
        return l;
      })
    );
  }

  // --- Generation Logic Update ---

  generateSpatialPrompt(): string {
    const layers = this.sceneLayers();
    if (layers.length === 0) return "";

    const descriptions: string[] = [];
    
    // Sort layers by X position to describe left-to-right
    const sortedByX = [...layers].sort((a, b) => a.x - b.x);

    sortedByX.forEach(layer => {
      const subject = this.subjects().find(s => s.subjectId === layer.subjectId || s.id === layer.subjectId);
      if (!subject) return;

      let position = "";
      if (layer.x < 33) position += "on the left";
      else if (layer.x > 66) position += "on the right";
      else position += "in the center";

      if (layer.y < 33) position += ", in the upper background";
      else if (layer.y > 66) position += ", in the foreground";
      
      if (layer.scale < 0.6) position += " (appearing small/distant)";
      else if (layer.scale > 1.5) position += " (appearing large/close-up)";

      descriptions.push(`[${subject.name}]: located ${position}. Visual: ${subject.prompt}`);
    });

    return `\n\nSPATIAL LAYOUT INSTRUCTIONS:\n${descriptions.join('\n')}\nCompose the scene respecting these relative positions.`;
  }

  async createProject(type: 'image' | 'video') {
    let squad = this.selectedSubjects();
    let prompt = this.newProjectPrompt();
    const ratio = this.selectedAspectRatio();
    
    // Override if in Canvas Mode
    if (this.isCanvasMode() && this.sceneLayers().length > 0) {
        const spatialPrompt = this.generateSpatialPrompt();
        prompt += spatialPrompt;
        
        // Also ensure the "squad" includes all layers in the canvas, even if not selected in gallery
        const layerSubjectIds = new Set(this.sceneLayers().map(l => l.subjectId));
        squad = this.subjects().filter(s => layerSubjectIds.has(s.id));
    }
    
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
    
    if (this.isCanvasMode()) {
         // In canvas mode, prompt already contains spatial info appended above
         fullPrompt = `Scene Description: ${prompt}`;
    } else {
        // Classic Mode
        if (squad.length === 1) {
            fullPrompt = `Character Reference Description: ${squad[0].prompt}. \n\nTarget Scene: ${prompt}.`;
        } else {
            const charDescriptions = squad.map((s, i) => `[Character ${i+1} (${s.name}) Visual Data: ${s.prompt}]`).join("\n");
            fullPrompt = `Scene with multiple characters:\n${charDescriptions}\n\nTarget Scene Description: ${prompt}.\nEnsure coherent interaction based on Visual Data provided.`;
        }
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
        // If canvas mode, we pick the first layer as reference or just the first subject
        const primary = squad[0]; 
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
    
    // Disable Canvas Mode on Remix for simplicity (simplification)
    this.isCanvasMode.set(false);
    this.sceneLayers.set([]);

    // 4. Navigate to Studio
    this.setView('studio');
  }

  cancelEdit() {
    this.editingProject.set(null);
    this.newProjectPrompt.set('');
    this.selectedAspectRatio.set('16:9');
    this.isCanvasMode.set(false);
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
  
  getSubjectById(id: string) {
      return this.subjects().find(s => s.id === id);
  }
}
