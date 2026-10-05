import { Injectable } from '@angular/core';
import { FeedParserService } from '../feeds/feed-parser.service';
import { ProviderAdapter, SyncSnapshot } from './provider.port';
import { Account, Article, PendingMutation } from '../domain/models';
import { stableId } from '../domain/feed-refresh';
import { StoragePort } from '../storage/storage.port';
import { FeedHttpService } from '../services/feed-http.service';

/**
 * Local RSS provider: subscriptions live in IndexedDB and sync re-fetches each
 * feed (skipping feeds excluded from sync), returning only items whose id is not
 * already stored - checked against every stored article, not a capped page, so
 * old items still listed in a feed never come back unread or lose their star. Subscription flags never leave storage, so user preferences
 * (folder, notification, sync exclusion) survive every refresh.
 */
@Injectable({providedIn:'root'}) export class LocalProvider extends ProviderAdapter {
  readonly kind='local' as const;
  constructor(private parser:FeedParserService, private storage:StoragePort, private http:FeedHttpService){super();}
  async connect(){return{id:crypto.randomUUID(),provider:this.kind,label:'Local RSS',createdAt:Date.now()};}
  async sync(account:Account):Promise<SyncSnapshot>{
    const subscriptions=(await this.storage.listSubscriptions(account.id)).filter(s=>s.feedUrl&&!s.syncExcluded);
    const candidates=new Map<string,Article>();
    const queue = [...subscriptions];
    const worker = async () => {
      for (let sub = queue.shift(); sub; sub = queue.shift()) {
      try{
        const response=await this.http.get(sub.feedUrl!);
        if(response.status<200||response.status>=300)continue;
        const parsed=this.parser.parse(response.body);
        for(const item of parsed.items){
          const id=stableId(account.id,item.uid);
          if(candidates.has(id))continue;
          candidates.set(id,{id,accountId:account.id,subscriptionId:sub.id,uid:item.uid,title:item.title,content:item.content,author:item.author,link:item.link,image:item.image,audio:item.audio,video:item.video,publishedAt:item.publishedAt,updatedAt:item.publishedAt,starred:false,cached:true,read:false,keepUnread:false});
        }
      }catch{/* feed unreachable this cycle; try again on the next one */}
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, subscriptions.length) }, worker));
    const stored=await this.storage.existingArticleIds([...candidates.keys()]);
    const articles=[...candidates.values()].filter(a=>!stored.has(a.id));
    return{subscriptions:[],tags:[],articles};
  }
  async push(_a:Account,c:PendingMutation[]){return c.map(x=>x.id);}
  parse(xml:string){return this.parser.parse(xml);}
}
