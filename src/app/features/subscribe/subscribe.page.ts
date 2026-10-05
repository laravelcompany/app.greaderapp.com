import { Component, OnInit, signal } from '@angular/core';
import { feedUrlKey } from '../../core/domain/feed-discovery';
import { addFailureReason } from '../../core/domain/add-failure';
import { CommonModule } from '@angular/common'; import { FormsModule } from '@angular/forms'; import { Router } from '@angular/router';
import { IonAccordion,IonAccordionGroup,IonBackButton,IonButton,IonButtons,IonContent,IonHeader,IonIcon,IonInput,IonItem,IonLabel,IonList,IonSearchbar,IonSegment,IonSegmentButton,IonSpinner,IonTitle,IonToolbar, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons'; import { alertCircle, checkmarkCircle, refreshOutline } from 'ionicons/icons';
import { StoragePort } from '../../core/storage/storage.port'; import { LocalFeedService } from '../../core/services/local-feed.service'; import { DirectoryBundle,DirectoryFeed,DirectoryService,PodcastResult,RecommendedFeed } from '../../core/services/directory.service';
@Component({selector:'app-subscribe',templateUrl:'subscribe.page.html',styleUrls:['subscribe.page.scss'],imports:[CommonModule,FormsModule,IonHeader,IonToolbar,IonButtons,IonBackButton,IonTitle,IonContent,IonSegment,IonSegmentButton,IonList,IonItem,IonInput,IonLabel,IonButton,IonSpinner,IonIcon,IonSearchbar,IonAccordion,IonAccordionGroup]})
export class SubscribePage implements OnInit { mode:'url'|'browse'|'news'|'podcasts'|'opml'='url';url='';query='';directoryQuery='';busy=signal(false);importProgress=signal('');pending=signal('');accountId='';bundles=signal<DirectoryBundle[]>([]);podcasts=signal<PodcastResult[]>([]);recommendations=signal<RecommendedFeed[]>([]);topics=['news','technology','science','business','php','laravel','design'];keywords=signal<string[]>([]);filtered=signal<DirectoryBundle[]>([]);
/** Feed URLs already in storage - the source of truth for the Added state, so it survives navigation and restarts. */
added=signal<ReadonlySet<string>>(new Set());
/** Inline directory/podcast load failure, kept separate from the toast so the empty pane does not read as a dead end. */
loadError=signal('');
/** Topic search has its own error/retry state, independent of loading the bundled directory. */
topicError=signal('');
private topicRequest=0;
constructor(private db:StoragePort,private feeds:LocalFeedService,private directory:DirectoryService,private router:Router,private toasts:ToastController){addIcons({alertCircle,checkmarkCircle,refreshOutline});}
async ngOnInit(){const accounts=await this.db.listAccounts();if(!accounts.length){await this.router.navigateByUrl('/accounts');return;}this.accountId=accounts[0].id;await this.refreshAdded();await this.loadDirectory();}
/** Re-read the persisted subscriptions and rebuild the Added set from their feed URLs. */
private async refreshAdded(){const subs=await this.db.listSubscriptions(this.accountId);const keys=new Set<string>();for(const sub of subs)for(const value of [sub.feedUrl,sub.uid]){const key=this.key(value);if(key)keys.add(key);}this.added.set(keys);}
/** Loose URL comparison so http/https, case and a trailing slash do not fool the duplicate check. */
private key(value:string|undefined){return feedUrlKey(value);}
isAdded(url:string|undefined){return this.added().has(this.key(url));}
/** Feeds whose add failed (429, 404, not a feed...) this session: marked Failed and blocked from being added, like the OPML import skips them. */
failures=signal<ReadonlyMap<string,string>>(new Map());
isFailed(url:string|undefined){return this.failures().has(this.key(url));}
failureReason(url:string|undefined){return this.failures().get(this.key(url))??'';}
private markFailed(url:string,error:unknown){const next=new Map(this.failures());next.set(this.key(url),addFailureReason(error));this.failures.set(next);}
async switchMode(mode:typeof this.mode){this.topicRequest++;this.busy.set(false);this.recommendations.set([]);this.mode=mode;this.query='';this.directoryQuery='';this.topicError.set('');this.podcasts.set([]);this.loadError.set('');if(mode==='browse'||mode==='news'){this.recommendations.set([]);await this.loadDirectory();}if(mode==='podcasts'&&!this.keywords().length)this.keywords.set(await this.directory.podcastKeywords());}
async loadDirectory(){if(this.mode!=='browse'&&this.mode!=='news')return;this.busy.set(true);this.loadError.set('');try{const rows=await this.directory.bundles(this.mode);this.bundles.set(rows);this.filterDirectory(this.directoryQuery);}catch(e){this.loadError.set(this.message(e));await this.toast(this.message(e),'danger');}finally{this.busy.set(false);}}
filterDirectory(value:string){this.directoryQuery=value;const q=value.toLowerCase();this.filtered.set(this.bundles().filter(b=>b.title.toLowerCase().includes(q)||b.feeds.some(f=>f.title.toLowerCase().includes(q))));}
async discoverTopic(value=this.query){const topic=value.trim();if(!topic)return;const request=++this.topicRequest;this.query=topic;this.recommendations.set([]);this.busy.set(true);this.topicError.set('');try{const rows=await this.directory.recommendations(topic);if(request!==this.topicRequest)return;this.recommendations.set(rows);if(!rows.length)this.topicError.set(`No feeds found for "${topic}". Try a broader topic.`);}catch(e){if(request!==this.topicRequest)return;this.topicError.set(this.message(e));await this.toast(this.message(e),'danger');}finally{if(request===this.topicRequest)this.busy.set(false);}}
async searchPodcast(value=this.query){if(!value.trim())return;this.query=value;this.busy.set(true);this.loadError.set('');try{this.podcasts.set(await this.directory.searchPodcasts(value));}catch(e){this.loadError.set(this.message(e));await this.toast(this.message(e),'danger');}finally{this.busy.set(false);}}
async add(value:string|DirectoryFeed){const url=typeof value==='string'?value:value.url;if(!url)return;
if(this.isAdded(url)){await this.toast('That feed is already in your subscriptions.','warning');return;}
if(this.isFailed(url)){await this.toast(this.failureReason(url),'danger');return;}
this.busy.set(true);this.pending.set(url);
try{const sub=await this.feeds.subscribe(this.accountId,url);this.url='';await this.refreshAdded();await this.toast(sub.unreadCount>0?`Added ${sub.title} - ${sub.unreadCount} new article${sub.unreadCount===1?'':'s'}`:`Added ${sub.title} (no articles in this feed yet)`,'success');}
catch(e){this.markFailed(url,e);await this.toast(this.failureReason(url),'danger');}
finally{this.busy.set(false);this.pending.set('');}}
async opml(event:Event){const input=event.target as HTMLInputElement;const file=input.files?.[0];if(!file)return;this.busy.set(true);try{this.importProgress.set('');const r=await this.feeds.importOpml(this.accountId,await file.text(),(done,total)=>this.importProgress.set(`${done} of ${total} feeds`));await this.refreshAdded();await this.toast(r.failed.length?`Imported ${r.imported} feed${r.imported===1?'':'s'}; ${r.failed.length} failed`:`Imported ${r.imported} feed${r.imported===1?'':'s'}`,r.failed.length?'warning':'success');if(r.failed.length)await this.toast(`Failed: ${r.failed.slice(0,3).join(', ')}${r.failed.length>3?', ...':''}`,'danger',5000);}catch(e){await this.toast(this.message(e),'danger');}finally{this.busy.set(false);this.importProgress.set('');input.value='';}}
/** A broken podcast cover collapses instead of leaving a dead image box. */
hideBrokenImage(e:Event){(e.target as HTMLElement).style.display='none';}
private message(e:unknown){return e instanceof Error?e.message:String(e);}
private async toast(message:string,color?:string,duration=3500){const toast=await this.toasts.create({message,duration,position:'bottom',color});await toast.present();}}
